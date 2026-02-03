"""
LLM Configuration Module
This module stores the system prompt and configuration for the AI agent.
The prompt can be dynamically updated through the UI.
"""

# Default system prompt for the healthcare AI assistant
DEFAULT_SYSTEM_PROMPT = """You are a compassionate and professional healthcare AI assistant conducting patient follow-up calls. Your primary goal is to ensure patient well-being and treatment adherence.

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

Remember to maintain HIPAA compliance and patient confidentiality throughout the conversation."""

# Current active prompt (can be modified at runtime)
current_system_prompt = DEFAULT_SYSTEM_PROMPT

# LLM configuration parameters
llm_config = {
    "temperature": 0.7,
    "max_tokens": 2048,
    "top_p": 0.9,
    "model": "gpt-4",  # or whatever model is being used
}

def get_system_prompt():
    """Get the current system prompt"""
    return current_system_prompt

def set_system_prompt(new_prompt):
    """Update the system prompt"""
    global current_system_prompt
    current_system_prompt = new_prompt
    return True

def get_llm_config():
    """Get the complete LLM configuration"""
    return {
        "system_prompt": current_system_prompt,
        **llm_config
    }

def update_llm_config(config_updates):
    """Update LLM configuration parameters"""
    global llm_config
    for key, value in config_updates.items():
        if key in llm_config:
            llm_config[key] = value
    return True

def reset_to_default():
    """Reset system prompt to default"""
    global current_system_prompt
    current_system_prompt = DEFAULT_SYSTEM_PROMPT
    return True