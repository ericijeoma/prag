// import 'dotenv/config';
// import Groq from "groq-sdk";

// const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// console.log("Groq API key", process.env.GROQ_API_KEY);

// async function main() {
//   const completion = await groq.chat.completions.create({
//     model: "openai/gpt-oss-120b",
//     messages: [
//       {
//         role: "user",
//         content: "Say hello in one sentence.",
//       },
//     ],
//   });
//   console.log(completion.choices[0]?.message?.content);
// }

// main().catch(console.error);

import 'dotenv/config';

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/baai/bge-small-en-v1.5`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: ['test sentence'] })
  }
);

const data = await response.json();
const embedding = data.result.data[0];
console.log('Dimension:', embedding.length); // 384