let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) process.exit(9);
  console.log(JSON.stringify({ response: input, stats: { models: { 'auto-flash': {} } } }));
});
