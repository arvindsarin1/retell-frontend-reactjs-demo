import React, { useEffect, useState, useRef } from "react";
import "./AppEnhanced.css";
import { RetellWebClient } from "retell-client-js-sdk";

const agentId = "agent_3ab8443434d70749d9e57fa4c8";

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

const AppEnhancedV2 = () => {
  const [isCalling, setIsCalling] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isAgentTalking, setIsAgentTalking] = useState(false);
  const [callObjectives, setCallObjectives] = useState<CallObjective[]>([]);
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
    systemPrompt: `You are a healthcare AI assistant focused on patient follow-up calls.
    
Call Objectives:
1. Warm Introduction - Greet patient by name and establish rapport
2. Health Status Assessment - Evaluate current symptoms and medication adherence
3. Appointment Coordination - Confirm or schedule next appointment based on availability
4. Patient Concerns - Address questions and document any new symptoms
5. Action Items Summary - Provide clear next steps and follow-up instructions`,
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
      initializeCallObjectives();
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
        analyzeTranscriptForObjectives(newTranscript);
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

  // Initialize call objectives from LLM prompt with better keywords
  const initializeCallObjectives = () => {
    const objectives = extractObjectivesFromPrompt(llmConfig.systemPrompt);
    setCallObjectives(objectives);
  };

  // Extract objectives from the LLM prompt with keywords
  const extractObjectivesFromPrompt = (prompt: string): CallObjective[] => {
    const objectivesSection = prompt.match(/Call Objectives:(.+?)(?=\n\n|$)/s);
    if (!objectivesSection) return [];

    const lines = objectivesSection[1].trim().split('\n');
    return lines
      .filter(line => line.match(/^\d+\./))
      .map((line, index) => {
        const parts = line.split('-');
        const title = parts[0].replace(/^\d+\./, '').trim();
        const description = parts[1]?.trim() || '';
        
        // Define keywords for each objective type
        let keywords: string[] = [];
        const lowerTitle = title.toLowerCase();
        
        if (lowerTitle.includes('introduction')) {
          keywords = ['hello', 'hi', 'good morning', 'good afternoon', 'speaking with', 'my name is'];
        } else if (lowerTitle.includes('health') || lowerTitle.includes('assessment')) {
          keywords = ['symptoms', 'medication', 'feeling', 'pain', 'taking', 'dose', 'side effects'];
        } else if (lowerTitle.includes('appointment')) {
          keywords = ['appointment', 'schedule', 'next visit', 'available', 'calendar', 'date', 'time'];
        } else if (lowerTitle.includes('concern') || lowerTitle.includes('question')) {
          keywords = ['questions', 'concerns', 'wondering', 'worried', 'anything else', 'help with'];
        } else if (lowerTitle.includes('summary') || lowerTitle.includes('action')) {
          keywords = ['summary', 'recap', 'remember', 'next steps', 'follow up', 'will do'];
        }
        
        return {
          id: `obj-${index}`,
          title,
          description,
          completed: false,
          keywords
        };
      });
  };

  // Analyze transcript to check objective completion with improved accuracy
  const analyzeTranscriptForObjectives = (transcriptData: TranscriptEntry[]) => {
    const fullTranscript = transcriptData.map(t => t.content.toLowerCase()).join(' ');
    
    setCallObjectives(prev => prev.map(obj => {
      if (obj.completed) return obj;
      
      // Check if any keywords are present in the transcript
      const keywordMatch = obj.keywords.some(keyword => 
        fullTranscript.includes(keyword.toLowerCase())
      );
      
      // For more accuracy, check context around keywords
      const contextualMatch = obj.keywords.some(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        return regex.test(fullTranscript);
      });
      
      return { ...obj, completed: keywordMatch && contextualMatch };
    }));
  };

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
      if (medicationContext) {
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
    if (engagementMatches && engagementMatches.length > 3) {
      newInsights.push({
        id: `insight-eng-${Date.now()}`,
        type: 'engagement',
        content: 'Patient shows high engagement with multiple affirmative responses',
        timestamp: new Date()
      });
    }
    
    // Detect action items
    const actionPatterns = /\b(will|need to|should|must|have to|going to|schedule|call|follow up)\b/gi;
    const actionMatches = fullText.match(actionPatterns);
    if (actionMatches) {
      const actionContext = transcriptData.filter(t => 
        actionPatterns.test(t.content) && t.role === 'agent'
      ).slice(-1);
      if (actionContext.length > 0) {
        newInsights.push({
          id: `insight-act-${Date.now()}`,
          type: 'action',
          content: `Action item: "${actionContext[0].content.substring(0, 100)}..."`,
          timestamp: new Date()
        });
      }
    }
    
    setCallInsights(newInsights);
  };

  // Update sentiment based on transcript content
  const updateSentimentFromTranscript = (transcriptData: TranscriptEntry[]) => {
    const recentTranscript = transcriptData.slice(-10); // Last 10 messages
    let sentimentTotal = 0;
    let sentimentCount = 0;
    
    recentTranscript.forEach(entry => {
      const text = entry.content.toLowerCase();
      
      // Positive indicators
      const positiveWords = ['great', 'good', 'excellent', 'thank', 'appreciate', 'better', 'improved', 'happy'];
      const positiveScore = positiveWords.filter(word => text.includes(word)).length;
      
      // Negative indicators
      const negativeWords = ['pain', 'worse', 'bad', 'worried', 'concerned', 'difficult', 'problem', 'issue'];
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
      // Fallback: use transcript count if timing not available
      const agentMessages = transcript.filter(t => t.role === 'agent').length;
      const userMessages = transcript.filter(t => t.role === 'user').length;
      const total = agentMessages + userMessages;
      if (total > 0) {
        agentPercent = Math.round((agentMessages / total) * 100);
        userPercent = Math.round((userMessages / total) * 100);
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
      await fetch("http://localhost:8080/monitoring-input", {
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
      const response = await fetch("http://localhost:8080/update-agent-config", {
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
      const response = await fetch("http://localhost:8080/create-web-call", {
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
                <p>Follow-up Call Agent</p>
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

          {/* Call Objectives */}
          <div className="objectives-section">
            <h3>Call Objectives</h3>
            <div className="objectives-list">
              {callObjectives.map((objective) => (
                <div 
                  key={objective.id} 
                  className={`objective-item ${objective.completed ? 'completed' : ''}`}
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
                Completion: {callObjectives.filter(o => o.completed).length}/{callObjectives.length}
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill"
                  style={{ 
                    width: `${(callObjectives.filter(o => o.completed).length / callObjectives.length) * 100}%` 
                  }}
                ></div>
              </div>
            </div>
          </div>

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
                    <span className="monitoring-content">{msg.content}</span>
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
                        {entry.content}
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
                    {' '}{insight.content}
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
              <h2>LLM Configuration</h2>
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
                  rows={10}
                  placeholder="Enter the system prompt for the AI agent..."
                />
                <p className="help-text">
                  Define call objectives using numbered format (e.g., "1. Introduction - Greet the patient")
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

export default AppEnhancedV2;