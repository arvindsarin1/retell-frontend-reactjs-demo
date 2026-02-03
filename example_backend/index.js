const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 8080;

// Middleware to parse JSON bodies
app.use(cors());

app.use(express.json());

app.post('/create-web-call', async (req, res) => {
    const { agent_id, metadata, retell_llm_dynamic_variables } = req.body;

    // Prepare the payload for the API request
    const payload = { agent_id };

    // Conditionally add optional fields if they are provided
    if (metadata) {
        payload.metadata = metadata;
    }

    if (retell_llm_dynamic_variables) {
        payload.retell_llm_dynamic_variables = retell_llm_dynamic_variables;
    }

    try {
        const response = await axios.post(
            'https://api.retellai.com/v2/create-web-call',
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.RETELL_API_KEY}`, // Retell API key from env
                    'Content-Type': 'application/json',
                },
            }
        );

        res.status(201).json(response.data);
    } catch (error) {
        console.error('Error creating web call:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            message: error.message,
            config: {
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers
            }
        });
        res.status(error.response?.status || 500).json({ 
            error: 'Failed to create web call',
            details: error.response?.data || error.message 
        });
    }
});

// Update agent configuration endpoint
app.post('/update-agent-config', async (req, res) => {
    const { agent_id, llm_config } = req.body;

    try {
        // Note: This is a placeholder. In production, you would:
        // 1. Call Retell API to update the agent's LLM configuration
        // 2. Store the configuration in your database
        // 3. Apply the new prompt to the agent
        
        // For now, we'll just acknowledge the update
        console.log('Updating agent configuration:', {
            agent_id,
            systemPrompt: llm_config.systemPrompt.substring(0, 100) + '...',
            temperature: llm_config.temperature,
            maxTokens: llm_config.maxTokens,
            topP: llm_config.topP
        });

        res.status(200).json({ 
            success: true, 
            message: 'Agent configuration updated successfully' 
        });
    } catch (error) {
        console.error('Error updating agent configuration:', error);
        res.status(500).json({ error: 'Failed to update agent configuration' });
    }
});

// Monitoring mode input endpoint
app.post('/monitoring-input', async (req, res) => {
    const { agent_id, monitoring_input, context } = req.body;

    try {
        // In production, this would:
        // 1. Send the monitoring input to the active Retell conversation
        // 2. Inject it into the LLM context dynamically
        // 3. Update the agent's behavior in real-time
        
        console.log('Monitoring input received:', {
            agent_id,
            input: monitoring_input,
            contextLength: context ? context.length : 0
        });

        // For demo purposes, acknowledge the input
        res.status(200).json({ 
            success: true, 
            message: 'Monitoring input processed and sent to agent' 
        });
    } catch (error) {
        console.error('Error processing monitoring input:', error);
        res.status(500).json({ error: 'Failed to process monitoring input' });
    }
});

// Get LLM configuration endpoint
app.get('/llm-config', async (req, res) => {
    try {
        // Read the llm_config.py file
        const configPath = path.join(__dirname, 'llm_config.py');
        const configContent = await fs.readFile(configPath, 'utf-8');
        
        // Extract the current prompt using regex
        const promptMatch = configContent.match(/current_system_prompt = """(.+?)"""/s);
        const defaultPromptMatch = configContent.match(/DEFAULT_SYSTEM_PROMPT = """(.+?)"""/s);
        
        // Extract LLM parameters
        const tempMatch = configContent.match(/"temperature":\s*([0-9.]+)/);
        const maxTokensMatch = configContent.match(/"max_tokens":\s*([0-9]+)/);
        const topPMatch = configContent.match(/"top_p":\s*([0-9.]+)/);
        
        const config = {
            system_prompt: promptMatch ? promptMatch[1] : (defaultPromptMatch ? defaultPromptMatch[1] : ''),
            temperature: tempMatch ? parseFloat(tempMatch[1]) : 0.7,
            max_tokens: maxTokensMatch ? parseInt(maxTokensMatch[1]) : 2048,
            top_p: topPMatch ? parseFloat(topPMatch[1]) : 0.9
        };
        
        res.status(200).json(config);
    } catch (error) {
        console.error('Error reading LLM configuration:', error);
        res.status(500).json({ error: 'Failed to read LLM configuration' });
    }
});

// Update LLM configuration endpoint
app.post('/llm-config', async (req, res) => {
    const { system_prompt, temperature, max_tokens, top_p } = req.body;
    
    try {
        const configPath = path.join(__dirname, 'llm_config.py');
        let configContent = await fs.readFile(configPath, 'utf-8');
        
        // Update the current_system_prompt
        if (system_prompt !== undefined) {
            configContent = configContent.replace(
                /current_system_prompt = """.*?"""/s,
                `current_system_prompt = """${system_prompt}"""`
            );
        }
        
        // Update temperature
        if (temperature !== undefined) {
            configContent = configContent.replace(
                /"temperature":\s*[0-9.]+/,
                `"temperature": ${temperature}`
            );
        }
        
        // Update max_tokens
        if (max_tokens !== undefined) {
            configContent = configContent.replace(
                /"max_tokens":\s*[0-9]+/,
                `"max_tokens": ${max_tokens}`
            );
        }
        
        // Update top_p
        if (top_p !== undefined) {
            configContent = configContent.replace(
                /"top_p":\s*[0-9.]+/,
                `"top_p": ${top_p}`
            );
        }
        
        // Write back to file
        await fs.writeFile(configPath, configContent, 'utf-8');
        
        // Update Retell agent configuration
        if (system_prompt) {
            // Here you would typically call Retell API to update the agent
            // For now, we'll just log it
            console.log('System prompt updated. Ready to apply to Retell agent.');
        }
        
        res.status(200).json({ 
            success: true, 
            message: 'LLM configuration updated successfully' 
        });
    } catch (error) {
        console.error('Error updating LLM configuration:', error);
        res.status(500).json({ error: 'Failed to update LLM configuration' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
