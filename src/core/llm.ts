import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("GEMINI_API_KEY is not set in .env file.");
}

const genAI = new GoogleGenerativeAI(apiKey || "");

export function getModel(systemInstruction?: string) {
  return genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite",
    systemInstruction: systemInstruction,
  });
}

// Default model
export const model = getModel();

export async function askGemini(prompt: string, systemInstruction?: string) {
  const m = getModel(systemInstruction);
  const result = await m.generateContent(prompt);
  return result.response.text();
}
