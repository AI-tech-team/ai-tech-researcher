import { VertexAI } from '@google-cloud/vertexai';
import dotenv from 'dotenv';

dotenv.config();

const project = process.env.GCP_PROJECT_ID || '';
const location = process.env.GCP_LOCATION || 'us-central1';

// Initialize Vertex AI
const vertexAI = new VertexAI({ project: project, location: location });

export function getModel(systemInstruction?: string) {
  return vertexAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: systemInstruction ? { role: 'system', parts: [{ text: systemInstruction }] } : undefined,
  });
}

// Default model for simple tasks
export const model = getModel();

export async function askGemini(prompt: string, systemInstruction?: string) {
  const m = getModel(systemInstruction);
  const result = await m.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  
  const response = await result.response;
  return response.candidates?.[0].content.parts[0].text || '';
}
