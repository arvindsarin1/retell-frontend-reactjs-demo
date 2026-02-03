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
}

interface CallObjective {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

interface Analytics {
  wordsPerMinute: number;
  interruptions: number;
  silencePercentage: number;
  confidenceScore: number;
  sentiment: string;
  talkTime: {
    agent: number;
    user: number;
  };
}

interface LLMPromptConfig {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
}

const retellWebClient = new RetellWebClient();

const AppEnhanced = () => {
  const [isCalling, setIsCalling] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isAgentTalking, setIsAgentTalking] = useState(false);
  const [callObjectives, setCallObjectives] = useState<CallObjective[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    wordsPerMinute: 0,
    interruptions: 0,
    silencePercentage: 0,
    confidenceScore: 100,
    sentiment: "neutral",
    talkTime: { agent: 0, user: 0 }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMPromptConfig>({
    systemPrompt: `You are a healthcare AI assistant focused on patient follow-up calls.
    
Call Objectives:
1. Introduction - Greet the patient warmly
2. Health Status Check - Ask about current symptoms and medication adherence
3. Appointment Scheduling - Confirm or schedule next appointment
4. Address Concerns - Answer any patient questions
5. Call Summary - Summarize key points and next steps`,
    temperature: 0.7,
    maxTokens: 2048,
    topP: 0.9
  });
  
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const analyticsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize the SDK and event listeners
  useEffect(() => {
    retellWebClient.on("call_started", () => {
      console.log("call started");
      initializeCallObjectives();
      startAnalyticsTracking();
    });
    
    retellWebClient.on("call_ended", () => {
      console.log("call ended");
      setIsCalling(false);
      stopAnalyticsTracking();
    });
    
    retellWebClient.on("agent_start_talking", () => {
      console.log("agent_start_talking");
      setIsAgentTalking(true);
    });
    
    retellWebClient.on("agent_stop_talking", () => {
      console.log("agent_stop_talking");
      setIsAgentTalking(false);
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

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Initialize call objectives from LLM prompt
  const initializeCallObjectives = () => {
    const objectives = extractObjectivesFromPrompt(llmConfig.systemPrompt);
    setCallObjectives(objectives);
  };

  // Extract objectives from the LLM prompt
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
        return {
          id: `obj-${index}`,
          title,
          description,
          completed: false
        };
      });
  };

  // Analyze transcript to check objective completion
  const analyzeTranscriptForObjectives = (transcriptData: TranscriptEntry[]) => {
    const fullTranscript = transcriptData.map(t => t.content.toLowerCase()).join(' ');
    
    setCallObjectives(prev => prev.map(obj => {
      let completed = false;
      
      // Simple keyword-based completion detection
      if (obj.title.toLowerCase().includes('introduction')) {
        completed = fullTranscript.includes('hello') || fullTranscript.includes('hi') || fullTranscript.includes('good');
      } else if (obj.title.toLowerCase().includes('health status')) {
        completed = fullTranscript.includes('symptoms') || fullTranscript.includes('medication') || fullTranscript.includes('feeling');
      } else if (obj.title.toLowerCase().includes('appointment')) {
        completed = fullTranscript.includes('appointment') || fullTranscript.includes('schedule') || fullTranscript.includes('next visit');
      } else if (obj.title.toLowerCase().includes('concerns')) {
        completed = fullTranscript.includes('questions') || fullTranscript.includes('concerns') || fullTranscript.includes('anything else');
      } else if (obj.title.toLowerCase().includes('summary')) {
        completed = fullTranscript.includes('summary') || fullTranscript.includes('recap') || fullTranscript.includes('remember');
      }
      
      return { ...obj, completed: obj.completed || completed };
    }));
  };

  // Start real-time analytics tracking
  const startAnalyticsTracking = () => {
    analyticsIntervalRef.current = setInterval(() => {
      updateAnalytics();
    }, 2000);
  };

  const stopAnalyticsTracking = () => {
    if (analyticsIntervalRef.current) {
      clearInterval(analyticsIntervalRef.current);
      analyticsIntervalRef.current = null;
    }
  };

  // Update analytics with simulated data (replace with real API calls)
  const updateAnalytics = async () => {
    // Simulate API call to get analytics
    // In production, replace with actual API call to Retell or your analytics service
    
    const wordsCount = transcript.reduce((acc, entry) => 
      acc + entry.content.split(' ').length, 0
    );
    const callDuration = transcript.length > 0 ? 
      (Date.now() - transcript[0].timestamp.getTime()) / 1000 / 60 : 0;
    
    setAnalytics(prev => ({
      wordsPerMinute: callDuration > 0 ? Math.round(wordsCount / callDuration) : 0,
      interruptions: Math.floor(Math.random() * 3),
      silencePercentage: Math.round(5 + Math.random() * 15),
      confidenceScore: Math.round(85 + Math.random() * 15),
      sentiment: getSentiment(),
      talkTime: calculateTalkTime()
    }));
  };

  const getSentiment = () => {
    const sentiments = ['positive', 'neutral', 'negative'];
    return sentiments[Math.floor(Math.random() * sentiments.length)];
  };

  const calculateTalkTime = () => {
    const agentTime = transcript.filter(t => t.role === 'agent').length;
    const userTime = transcript.filter(t => t.role === 'user').length;
    const total = agentTime + userTime || 1;
    
    return {
      agent: Math.round((agentTime / total) * 100),
      user: Math.round((userTime / total) * 100)
    };
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
    // API call to update agent configuration with new prompt
    // This would typically call your backend which updates Retell agent
    try {
      const response = await fetch("http://localhost:8080/update-agent-config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: agentId,
          llm_config: llmConfig
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

  return (
    <div className="app-enhanced">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="logo-text">Copper Digital</h1>
          <span className="version-badge">Enterprise v2.1</span>
        </div>
        
        <div className="header-controls">
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
            <div className={`sentiment-indicator ${analytics.sentiment}`}>
              {analytics.sentiment === 'positive' && '😊'}
              {analytics.sentiment === 'neutral' && '😐'}
              {analytics.sentiment === 'negative' && '😟'}
              <span>{analytics.sentiment}</span>
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
              <li>✓ Patient engaged throughout call</li>
              <li>✓ All medications discussed</li>
              <li>⚠️ Follow-up appointment needed</li>
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

export default AppEnhanced;