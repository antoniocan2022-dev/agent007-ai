console.log('OPENAI_API_KEY env:', process.env.OPENAI_API_KEY ? 'SET (' + process.env.OPENAI_API_KEY.slice(0, 10) + '...)' : 'NOT SET')
console.log('OPENAI_MODEL env:', process.env.OPENAI_MODEL || 'gpt-4o-mini (default)')
console.log('OPENAI_BASE_URL env:', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1 (default)')
process.exit(0)
