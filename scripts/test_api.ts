import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

async function run() {
  const models = await genAI.getGenerativeModel({ model: "gemini-pro" }); // Wait, ListModels is not available in @google/generative-ai SDK easily.
  console.log("Cannot list models easily with this SDK version, let me just fetch via REST.");
}

run();
