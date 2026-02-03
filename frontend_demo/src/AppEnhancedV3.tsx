import React, { useEffect, useState, useRef } from "react";
import "./AppEnhanced.css";
import { RetellWebClient } from "retell-client-js-sdk";

const agentId = process.env.REACT_APP_RETELL_AGENT_ID || "agent_3ab8443434d70749d9e57fa4c8";

interface RegisterCallResponse {
  access_token: string;
}

interface TranscriptEntry {
  role: string;
  content: string;
  timestamp: Date;
  endTime?: Date;
}

interface CallObjective {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  keywords: string[];
  detectedAt?: Date;
}

interface Analytics {
  wordsPerMinute: number;
  interruptions: number;
  silencePercentage: number;
  confidenceScore: number;
  sentimentScore: number; // 0-100, where 0 is negative, 50 is neutral, 100 is positive
  talkTime: {
    agent: number;
    user: number;
  };
}

interface CallInsight {
  id: string;
  type: 'engagement' | 'medication' | 'action' | 'concern';
  content: string;
  timestamp: Date;
}

interface LLMPromptConfig {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
}

interface MonitoringMessage {
  id: string;
  content: string;
  timestamp: Date;
}

const retellWebClient = new RetellWebClient();

// Default comprehensive healthcare prompt
const DEFAULT_SYSTEM_PROMPT = `You are a compassionate and professional healthcare AI assistant conducting patient follow-up calls. Your primary goal is to ensure patient well-being and treatment adherence.

Core Responsibilities:
- Build rapport with warm, personalized greetings
- Assess current health status and symptom progression
- Verify medication adherence and address any side effects
- Schedule or confirm upcoming appointments
- Document patient concerns and questions
- Provide clear follow-up instructions

Communication Style:
- Use empathetic and patient-centered language
- Listen actively and acknowledge patient concerns
- Speak clearly and avoid medical jargon
- Allow patients to express themselves fully
- Summarize key points for clarity

Key Areas to Cover:
1. Personal greeting and rapport building
2. Current symptom assessment
3. Medication review and adherence check
4. Appointment scheduling or confirmation
5. Address patient questions and concerns
6. Provide clear next steps and follow-up plan

Remember to maintain HIPAA compliance and patient confidentiality throughout the conversation.`;

const AppEnhancedV3 = () => {
  const [isCalling, setIsCalling] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isAgentTalking, setIsAgentTalking] = useState(false);
  const [callObjectives, setCallObjectives] = useState<CallObjective[]>([]);
  const [detectedObjectives, setDetectedObjectives] = useState<CallObjective[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    wordsPerMinute: 150, // Starting baseline
    interruptions: 0,
    silencePercentage: 0,
    confidenceScore: 100,
    sentimentScore: 50, // Neutral start
    talkTime: { agent: 0, user: 0 }
  });
  const [callInsights, setCallInsights] = useState<CallInsight[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [monitoringMode, setMonitoringMode] = useState(false);
  const [monitoringInput, setMonitoringInput] = useState("");
  const [monitoringMessages, setMonitoringMessages] = useState<MonitoringMessage[]>([]);
  const [llmConfig, setLlmConfig] = useState<LLMPromptConfig>({
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.7,
    maxTokens: 2048,
    topP: 0.9
  });
  
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const analyticsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const callStartTimeRef = useRef<Date | null>(null);
  const lastSpeakerRef = useRef<string | null>(null);
  const speechStartTimesRef = useRef<{ [key: string]: Date }>({});
  const totalSpeechTimeRef = useRef<{ agent: number; user: number }>({ agent: 0, user: 0 });
  const wordCountRef = useRef(0);
  const interruptionCountRef = useRef(0);
  const silenceStartRef = useRef<Date | null>(null);
  const totalSilenceRef = useRef(0);

  // Initialize the SDK and event listeners
  useEffect(() => {
    retellWebClient.on("call_started", () => {
      console.log("call started");
      callStartTimeRef.current = new Date();
      // Don't show objectives initially - they'll be detected dynamically
      setDetectedObjectives([]);
      startAnalyticsTracking();
    });
    
    retellWebClient.on("call_ended", () => {
      console.log("call ended");
      setIsCalling(false);
      stopAnalyticsTracking();
      generateFinalInsights();
    });
    
    retellWebClient.on("agent_start_talking", () => {
      console.log("agent_start_talking");
      setIsAgentTalking(true);
      handleSpeakerChange('agent');
    });
    
    retellWebClient.on("agent_stop_talking", () => {
      console.log("agent_stop_talking");
      setIsAgentTalking(false);
      handleSpeakerStop('agent');
    });
    
    retellWebClient.on("update", (update) => {
      console.log("Transcript update:", update);
      if (update.transcript) {
        const newTranscript = update.transcript.map((entry: any) => ({
          ...entry,
          timestamp: new Date()
        }));
        setTranscript(newTranscript);
        dynamicallyDetectObjectives(newTranscript);
        analyzeTranscriptForInsights(newTranscript);
        updateSentimentFromTranscript(newTranscript);
      }
    });
    
    retellWebClient.on("error", (error) => {
      console.error("An error occurred:", error);
      retellWebClient.stopCall();
    });

    return () => {
      stopAnalyticsTracking();
    };
  }, []);

  // Dynamically detect objectives from conversation context
  const dynamicallyDetectObjectives = (transcriptData: TranscriptEntry[]) => {
    const fullTranscript = transcriptData.map(t => t.content.toLowerCase()).join(' ');
    const agentTranscript = transcriptData
      .filter(t => t.role === 'agent')
      .map(t => t.content.toLowerCase())
      .join(' ');
    
    // Define potential objectives that could emerge from the conversation
    const potentialObjectives = [
      {
        id: 'greeting',
        title: 'Personal Greeting',
        keywords: ['hello', 'hi', 'good morning', 'good afternoon', 'speaking with', 'calling from'],
        description: 'Establish rapport with personalized greeting'
      },
      {
        id: 'health-check',
        title: 'Health Status Assessment',
        keywords: ['feeling', 'symptoms', 'pain', 'condition', 'health', 'better', 'worse'],
        description: 'Evaluate current symptoms and health condition'
      },
      {
        id: 'medication',
        title: 'Medication Review',
        keywords: ['medication', 'medicine', 'pills', 'dose', 'taking', 'prescription', 'side effects'],
        description: 'Verify medication adherence and side effects'
      },
      {
        id: 'appointment',
        title: 'Appointment Scheduling',
        keywords: ['appointment', 'schedule', 'visit', 'doctor', 'clinic', 'available', 'calendar'],
        description: 'Confirm or schedule follow-up appointments'
      },
      {
        id: 'concerns',
        title: 'Patient Concerns',
        keywords: ['questions', 'concerns', 'worried', 'wondering', 'help', 'clarify', 'understand'],
        description: 'Address patient questions and concerns'
      },
      {
        id: 'next-steps',
        title: 'Follow-up Plan',
        keywords: ['next steps', 'follow up', 'remember', 'important', 'make sure', 'will do'],
        description: 'Provide clear action items and next steps'
      }
    ];

    // Check which objectives have been introduced in the conversation
    const newDetectedObjectives = potentialObjectives.filter(obj => {
      // Check if this objective's keywords appear in agent's speech
      const isIntroduced = obj.keywords.some(keyword => 
        agentTranscript.includes(keyword)
      );
      
      if (isIntroduced && !detectedObjectives.find(d => d.id === obj.id)) {
        // Check if objective is completed
        const isCompleted = obj.keywords.filter(keyword => 
          fullTranscript.includes(keyword)
        ).length >= 2; // At least 2 keyword matches for completion
        
        return true;
      }
      return false;
    });

    // Add newly detected objectives
    if (newDetectedObjectives.length > 0) {
      setDetectedObjectives(prev => {
        const updated = [...prev];
        newDetectedObjectives.forEach(newObj => {
          if (!updated.find(o => o.id === newObj.id)) {
            updated.push({
              ...newObj,
              completed: false,
              detectedAt: new Date()
            });
          }
        });
        return updated;
      });
    }

    // Update completion status for existing objectives
    setDetectedObjectives(prev => prev.map(obj => {
      const keywordMatches = obj.keywords.filter(keyword => 
        fullTranscript.includes(keyword)
      ).length;
      
      // More sophisticated completion detection
      let completed = false;
      if (obj.id === 'greeting' && keywordMatches >= 1) {
        completed = true;
      } else if (keywordMatches >= 2) {
        // For other objectives, require at least 2 keyword matches
        completed = true;
      }
      
      return { ...obj, completed };
    }));
  };

  // Handle speaker changes for interruption detection
  const handleSpeakerChange = (speaker: string) => {
    const now = new Date();
    
    // Check for interruption
    if (lastSpeakerRef.current && lastSpeakerRef.current !== speaker && speechStartTimesRef.current[lastSpeakerRef.current]) {
      interruptionCountRef.current++;
    }
    
    // Start timing for this speaker
    speechStartTimesRef.current[speaker] = now;
    lastSpeakerRef.current = speaker;
    
    // End silence period if any
    if (silenceStartRef.current) {
      totalSilenceRef.current += now.getTime() - silenceStartRef.current.getTime();
      silenceStartRef.current = null;
    }
  };

  const handleSpeakerStop = (speaker: string) => {
    const now = new Date();
    
    // Calculate speech time
    if (speechStartTimesRef.current[speaker]) {
      const duration = now.getTime() - speechStartTimesRef.current[speaker].getTime();
      if (speaker === 'agent') {
        totalSpeechTimeRef.current.agent += duration;
      } else {
        totalSpeechTimeRef.current.user += duration;
      }
      delete speechStartTimesRef.current[speaker];
    }
    
    // Start silence timer
    silenceStartRef.current = now;
  };

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Analyze transcript for insights
  const analyzeTranscriptForInsights = (transcriptData: TranscriptEntry[]) => {
    const newInsights: CallInsight[] = [];
    const fullText = transcriptData.map(t => t.content).join(' ');
    
    // Detect medications mentioned
    const medicationPatterns = /\b(medication|medicine|pill|tablet|dose|prescription|drug)\b/gi;
    const medicationMatches = fullText.match(medicationPatterns);
    if (medicationMatches) {
      const medicationContext = transcriptData.find(t => 
        medicationPatterns.test(t.content)
      );
      if (medicationContext && !callInsights.find(i => i.type === 'medication' && i.content.includes(medicationContext.content.substring(0, 50)))) {
        newInsights.push({
          id: `insight-med-${Date.now()}`,
          type: 'medication',
          content: `Medication discussed: "${medicationContext.content.substring(0, 100)}..."`,
          timestamp: new Date()
        });
      }
    }
    
    // Detect patient engagement
    const engagementPatterns = /\b(yes|okay|understand|got it|makes sense|thank you|appreciate)\b/gi;
    const engagementMatches = fullText.match(engagementPatterns);
    if (engagementMatches && engagementMatches.length > 3 && !callInsights.find(i => i.type === 'engagement')) {
      newInsights.push({
        id: `insight-eng-${Date.now()}`,
        type: 'engagement',
        content: 'Patient shows high engagement with multiple affirmative responses',
        timestamp: new Date()
      });
    }
    
    // Detect action items
    const actionPatterns = /\b(will|need to|should|must|have to|going to|schedule|call|follow up)\b/gi;
    transcriptData.forEach(entry => {
      if (entry.role === 'agent' && actionPatterns.test(entry.content)) {
        const existingAction = callInsights.find(i => 
          i.type === 'action' && i.content.includes(entry.content.substring(0, 50))
        );
        if (!existingAction) {
          newInsights.push({
            id: `insight-act-${Date.now()}`,
            type: 'action',
            content: `Action item: "${entry.content.substring(0, 100)}..."`,
            timestamp: new Date()
          });
        }
      }
    });
    
    if (newInsights.length > 0) {
      setCallInsights(prev => [...prev, ...newInsights]);
    }
  };

  // Update sentiment based on transcript content
  const updateSentimentFromTranscript = (transcriptData: TranscriptEntry[]) => {
    const recentTranscript = transcriptData.slice(-10); // Last 10 messages
    let sentimentTotal = 0;
    let sentimentCount = 0;
    
    recentTranscript.forEach(entry => {
      const text = entry.content.toLowerCase();
      
      // Positive indicators
      const positiveWords = ['great', 'good', 'excellent', 'thank', 'appreciate', 'better', 'improved', 'happy', 'well'];
      const positiveScore = positiveWords.filter(word => text.includes(word)).length;
      
      // Negative indicators
      const negativeWords = ['pain', 'worse', 'bad', 'worried', 'concerned', 'difficult', 'problem', 'issue', 'trouble'];
      const negativeScore = negativeWords.filter(word => text.includes(word)).length;
      
      // Calculate sentiment for this entry (0-100 scale)
      const entrySentiment = 50 + (positiveScore * 10) - (negativeScore * 10);
      sentimentTotal += Math.max(0, Math.min(100, entrySentiment));
      sentimentCount++;
    });
    
    if (sentimentCount > 0) {
      const newSentiment = sentimentTotal / sentimentCount;
      // Smooth transition
      setAnalytics(prev => ({
        ...prev,
        sentimentScore: Math.round(prev.sentimentScore * 0.7 + newSentiment * 0.3)
      }));
    }
  };

  // Start real-time analytics tracking
  const startAnalyticsTracking = () => {
    analyticsIntervalRef.current = setInterval(() => {
      updateAnalytics();
    }, 1000); // Update every second for more accurate real-time data
  };

  const stopAnalyticsTracking = () => {
    if (analyticsIntervalRef.current) {
      clearInterval(analyticsIntervalRef.current);
      analyticsIntervalRef.current = null;
    }
  };

  // Update analytics with accurate calculations
  const updateAnalytics = async () => {
    if (!callStartTimeRef.current) return;
    
    const now = new Date();
    const callDuration = (now.getTime() - callStartTimeRef.current.getTime()) / 1000 / 60; // in minutes
    
    // Calculate WPM based on actual word count
    const totalWords = transcript.reduce((acc, entry) => 
      acc + entry.content.split(/\s+/).length, 0
    );
    const wpm = callDuration > 0 ? Math.round(totalWords / callDuration) : 150;
    
    // Calculate accurate talk time distribution
    const totalAgentTime = totalSpeechTimeRef.current.agent;
    const totalUserTime = totalSpeechTimeRef.current.user;
    const totalTalkTime = totalAgentTime + totalUserTime;
    
    let agentPercent = 0;
    let userPercent = 0;
    
    if (totalTalkTime > 0) {
      agentPercent = Math.round((totalAgentTime / totalTalkTime) * 100);
      userPercent = Math.round((totalUserTime / totalTalkTime) * 100);
    } else if (transcript.length > 0) {
      // Fallback: Initialize based on first speaker
      const firstSpeaker = transcript[0]?.role;
      if (firstSpeaker === 'agent') {
        agentPercent = 100;
        userPercent = 0;
      } else if (firstSpeaker === 'user') {
        agentPercent = 0;
        userPercent = 100;
      }
    }
    
    // Calculate silence percentage
    const totalCallTime = now.getTime() - callStartTimeRef.current.getTime();
    const currentSilence = silenceStartRef.current ? 
      now.getTime() - silenceStartRef.current.getTime() : 0;
    const totalSilenceTime = totalSilenceRef.current + currentSilence;
    const silencePercent = totalCallTime > 0 ? 
      Math.round((totalSilenceTime / totalCallTime) * 100) : 0;
    
    setAnalytics(prev => ({
      ...prev,
      wordsPerMinute: wpm,
      interruptions: interruptionCountRef.current,
      silencePercentage: Math.min(silencePercent, 100),
      talkTime: {
        agent: agentPercent,
        user: userPercent
      }
    }));
  };

  // Generate final insights when call ends
  const generateFinalInsights = () => {
    // This would analyze the complete transcript and generate comprehensive insights
    console.log("Generating final call insights...");
  };

  // Send monitoring mode input to LLM
  const sendMonitoringInput = async () => {
    if (!monitoringInput.trim()) return;
    
    const message: MonitoringMessage = {
      id: `monitor-${Date.now()}`,
      content: monitoringInput,
      timestamp: new Date()
    };
    
    setMonitoringMessages(prev => [...prev, message]);
    
    // Send to backend to influence LLM
    try {
      await fetch(`${process.env.REACT_APP_API_URL || "http://localhost:8080"}/monitoring-input`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: agentId,
          monitoring_input: monitoringInput,
          context: transcript.slice(-5) // Send recent context
        }),
      });
    } catch (error) {
      console.error("Error sending monitoring input:", error);
    }
    
    setMonitoringInput("");
  };

  const toggleConversation = async () => {
    if (isCalling) {
      retellWebClient.stopCall();
    } else {
      const registerCallResponse = await registerCall(agentId);
      if (registerCallResponse.access_token) {
        // Update agent configuration with current LLM prompt
        await updateAgentConfiguration();
        
        retellWebClient
          .startCall({
            accessToken: registerCallResponse.access_token,
          })
          .catch(console.error);
        setIsCalling(true);
      }
    }
  };

  const updateAgentConfiguration = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL || "http://localhost:8080"}/update-agent-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: agentId,
          llm_config: llmConfig,
          monitoring_mode: monitoringMode
        }),
      });
      
      if (!response.ok) {
        console.error("Failed to update agent configuration");
      }
    } catch (error) {
      console.error("Error updating agent configuration:", error);
    }
  };

  async function registerCall(agentId: string): Promise<RegisterCallResponse> {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL || "http://localhost:8080"}/create-web-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: agentId,
        }),
      });
  
      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }
  
      const data: RegisterCallResponse = await response.json();
      return data;
    } catch (err: any) {
      console.log(err);
      throw new Error(err);
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const exportTranscript = () => {
    const content = transcript.map(entry => 
      `[${formatTime(entry.timestamp)}] ${entry.role.toUpperCase()}: ${entry.content}`
    ).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Get sentiment color based on score
  const getSentimentColor = (score: number) => {
    // score is 0-100, where 0 is red (negative), 50 is yellow (neutral), 100 is green (positive)
    if (score <= 50) {
      // Red to Yellow
      const ratio = score / 50;
      const r = 255;
      const g = Math.round(255 * ratio);
      const b = 0;
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // Yellow to Green
      const ratio = (score - 50) / 50;
      const r = Math.round(255 * (1 - ratio));
      const g = 255;
      const b = 0;
      return `rgb(${r}, ${g}, ${b})`;
    }
  };

  return (
    <div className="app-enhanced">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <img 
            src="/copper-digital-logo.jpg" 
            alt="Copper Digital" 
            className="company-logo"
          />
        </div>
        
        <div className="header-controls">
          <button 
            className={`monitor-toggle ${monitoringMode ? 'active' : ''}`}
            onClick={() => setMonitoringMode(!monitoringMode)}
            title="Toggle Monitoring Mode"
          >
            <span className="monitor-icon">👁️</span>
            <span>Monitoring Mode</span>
          </button>
          
          <div className="connection-status">
            <div className={`status-indicator ${isCalling ? 'active' : ''}`}></div>
            <span>{isCalling ? 'Call Active' : 'Ready'}</span>
          </div>
          
          <button 
            className="settings-button"
            onClick={() => setShowSettings(!showSettings)}
            title="LLM Configuration"
          >
            ⚙️ Settings
          </button>
        </div>
      </header>

      <div className="main-layout">
        {/* Left Panel - Call Control & Objectives */}
        <div className="left-panel">
          <div className="agent-section">
            <h3>Voice Agent Control</h3>
            <div className="agent-info">
              <div className="agent-avatar">
                <span>🤖</span>
              </div>
              <div className="agent-details">
                <h4>Healthcare Assistant</h4>
                <p>AI Voice Agent</p>
              </div>
            </div>
            
            <button 
              onClick={toggleConversation}
              className={`call-button ${isCalling ? 'active' : ''}`}
            >
              {isCalling ? (
                <>
                  <span className="call-icon">📞</span>
                  <span>End Call</span>
                </>
              ) : (
                <>
                  <span className="call-icon">📞</span>
                  <span>Start Call</span>
                </>
              )}
            </button>

            {isCalling && (
              <div className="voice-indicator">
                <div className={`voice-bars ${isAgentTalking ? 'talking' : ''}`}>
                  <div className="bar"></div>
                  <div className="bar"></div>
                  <div className="bar"></div>
                  <div className="bar"></div>
                </div>
                <span>{isAgentTalking ? 'Agent Speaking' : 'Listening'}</span>
              </div>
            )}
          </div>

          {/* Call Objectives - Only show when detected */}
          {detectedObjectives.length > 0 && (
            <div className="objectives-section">
              <h3>Call Objectives</h3>
              <p className="objectives-subtitle">Dynamically detected from conversation</p>
              <div className="objectives-list">
                {detectedObjectives.map((objective) => (
                  <div 
                    key={objective.id} 
                    className={`objective-item ${objective.completed ? 'completed' : ''} fade-in`}
                  >
                    <div className="objective-checkbox">
                      {objective.completed ? '✓' : '○'}
                    </div>
                    <div className="objective-content">
                      <h4>{objective.title}</h4>
                      {objective.description && <p>{objective.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="objectives-progress">
                <div className="progress-text">
                  Completion: {detectedObjectives.filter(o => o.completed).length}/{detectedObjectives.length}
                </div>
                <div className="progress-bar">
                  <div 
                    className="progress-fill"
                    style={{ 
                      width: `${detectedObjectives.length > 0 ? (detectedObjectives.filter(o => o.completed).length / detectedObjectives.length) * 100 : 0}%` 
                    }}
                  ></div>
                </div>
              </div>
            </div>
          )}

          {/* Monitoring Mode Input */}
          {monitoringMode && (
            <div className="monitoring-section">
              <h3>Back-Office Guidance</h3>
              <div className="monitoring-input-container">
                <textarea
                  value={monitoringInput}
                  onChange={(e) => setMonitoringInput(e.target.value)}
                  placeholder="Type guidance for the AI agent..."
                  rows={3}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMonitoringInput();
                    }
                  }}
                />
                <button 
                  className="send-monitoring-button"
                  onClick={sendMonitoringInput}
                  disabled={!monitoringInput.trim()}
                >
                  Send
                </button>
              </div>
              <div className="monitoring-history">
                {monitoringMessages.map(msg => (
                  <div key={msg.id} className="monitoring-message">
                    <span className="monitoring-time">{formatTime(msg.timestamp)}</span>
                    <span className="monitoring-content">{typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center Panel - Transcript */}
        <div className="transcript-section">
          <div className="transcript-header">
            <div className="transcript-title">
              <h2>Live Call Transcript</h2>
              <div className="transcript-actions">
                <button className="action-button" onClick={exportTranscript}>
                  📥 Export
                </button>
                <button className="action-button">
                  🔍 Search
                </button>
              </div>
            </div>
          </div>
          
          <div className="messages-container">
            {transcript.length === 0 ? (
              <div className="empty-state">
                <p>Start a call to see the live transcript...</p>
              </div>
            ) : (
              <>
                {transcript.map((entry, index) => (
                  <div key={index} className={`message ${entry.role}`}>
                    <div className="message-avatar-container">
                      <div className={`message-avatar ${entry.role}`}>
                        {entry.role === 'agent' ? '🤖' : '👤'}
                      </div>
                    </div>
                    <div className="message-content-wrapper">
                      <div className="message-header">
                        <span className="message-sender">
                          {entry.role === 'agent' ? 'Healthcare Assistant' : 'Patient'}
                        </span>
                        <span className="message-time">{formatTime(entry.timestamp)}</span>
                      </div>
                      <div className="message-content">
                        {typeof entry.content === 'object' ? JSON.stringify(entry.content) : entry.content}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </>
            )}
          </div>
        </div>

        {/* Right Panel - Analytics */}
        <div className="analytics-panel">
          <div className="panel-header">
            <h3>Real-time Analytics</h3>
          </div>
          
          <div className="analytics-grid">
            <div className="analytics-card">
              <div className="analytics-value">{analytics.wordsPerMinute}</div>
              <div className="analytics-label">Words/Min</div>
            </div>
            <div className="analytics-card">
              <div className="analytics-value">{analytics.interruptions}</div>
              <div className="analytics-label">Interruptions</div>
            </div>
            <div className="analytics-card">
              <div className="analytics-value">{analytics.silencePercentage}%</div>
              <div className="analytics-label">Silence</div>
            </div>
            <div className="analytics-card">
              <div className="analytics-value">{analytics.confidenceScore}%</div>
              <div className="analytics-label">Confidence</div>
            </div>
          </div>

          <div className="sentiment-section">
            <h4>Call Sentiment</h4>
            <div className="sentiment-gradient-container">
              <div 
                className="sentiment-gradient"
                style={{ 
                  background: `linear-gradient(to right, #ff0000 0%, #ffff00 50%, #00ff00 100%)`
                }}
              >
                <div 
                  className="sentiment-indicator-dot"
                  style={{ 
                    left: `${analytics.sentimentScore}%`,
                    backgroundColor: getSentimentColor(analytics.sentimentScore)
                  }}
                ></div>
              </div>
              <div className="sentiment-labels">
                <span>Negative</span>
                <span>Neutral</span>
                <span>Positive</span>
              </div>
            </div>
          </div>

          <div className="talk-time-section">
            <h4>Talk Time Distribution</h4>
            <div className="talk-time-bars">
              <div className="talk-time-bar">
                <div className="bar-label">Agent</div>
                <div className="bar-container">
                  <div 
                    className="bar-fill agent"
                    style={{ width: `${analytics.talkTime.agent}%` }}
                  ></div>
                </div>
                <div className="bar-value">{analytics.talkTime.agent}%</div>
              </div>
              <div className="talk-time-bar">
                <div className="bar-label">Patient</div>
                <div className="bar-container">
                  <div 
                    className="bar-fill user"
                    style={{ width: `${analytics.talkTime.user}%` }}
                  ></div>
                </div>
                <div className="bar-value">{analytics.talkTime.user}%</div>
              </div>
            </div>
          </div>

          <div className="insights-section">
            <h4>Call Insights</h4>
            <ul className="insights-list">
              {callInsights.length === 0 ? (
                <li className="no-insights">Insights will appear as the call progresses...</li>
              ) : (
                callInsights.map(insight => (
                  <li key={insight.id} className={`insight-item ${insight.type}`}>
                    {insight.type === 'engagement' && '✓'}
                    {insight.type === 'medication' && '💊'}
                    {insight.type === 'action' && '📋'}
                    {insight.type === 'concern' && '⚠️'}
                    {' '}{typeof insight.content === 'object' ? JSON.stringify(insight.content) : insight.content}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="settings-modal">
          <div className="settings-content">
            <div className="settings-header">
              <h2>Agent Configuration</h2>
              <button 
                className="close-button"
                onClick={() => setShowSettings(false)}
              >
                ✕
              </button>
            </div>
            
            <div className="settings-body">
              <div className="form-group">
                <label>System Prompt</label>
                <textarea
                  value={llmConfig.systemPrompt}
                  onChange={(e) => setLlmConfig({
                    ...llmConfig,
                    systemPrompt: e.target.value
                  })}
                  rows={15}
                  placeholder="Enter the system prompt for the AI agent..."
                  className="system-prompt-textarea"
                />
                <p className="help-text">
                  This prompt defines your agent's behavior, communication style, and objectives. 
                  The agent will dynamically identify and track objectives based on the conversation flow.
                </p>
              </div>
              
              <div className="settings-grid">
                <div className="form-group">
                  <label>Temperature</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={llmConfig.temperature}
                    onChange={(e) => setLlmConfig({
                      ...llmConfig,
                      temperature: parseFloat(e.target.value)
                    })}
                  />
                  <span className="value-display">{llmConfig.temperature}</span>
                  <p className="param-description">Controls randomness in responses</p>
                </div>
                
                <div className="form-group">
                  <label>Max Tokens</label>
                  <input
                    type="number"
                    value={llmConfig.maxTokens}
                    onChange={(e) => setLlmConfig({
                      ...llmConfig,
                      maxTokens: parseInt(e.target.value)
                    })}
                  />
                  <p className="param-description">Maximum response length</p>
                </div>
                
                <div className="form-group">
                  <label>Top P</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={llmConfig.topP}
                    onChange={(e) => setLlmConfig({
                      ...llmConfig,
                      topP: parseFloat(e.target.value)
                    })}
                  />
                  <span className="value-display">{llmConfig.topP}</span>
                  <p className="param-description">Nucleus sampling threshold</p>
                </div>
              </div>
              
              <div className="settings-actions">
                <button 
                  className="save-button"
                  onClick={() => {
                    updateAgentConfiguration();
                    setShowSettings(false);
                  }}
                >
                  Save Configuration
                </button>
                <button 
                  className="cancel-button"
                  onClick={() => setShowSettings(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppEnhancedV3;