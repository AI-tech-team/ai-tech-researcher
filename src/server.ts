import express from "express";
import cors from "cors";
import db from "./core/db";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 4000;

// API Endpoints
app.get("/api/sources", (req, res) => {
  const sources = db.prepare("SELECT * FROM sources ORDER BY score DESC").all();
  res.json(sources);
});

app.get("/api/reports", (req, res) => {
  const reports = db.prepare("SELECT * FROM reports ORDER BY report_date DESC").all();
  res.json(reports);
});

app.get("/api/stats", (req, res) => {
  const stats = {
    total_sources: db.prepare("SELECT COUNT(*) as count FROM sources").get().count,
    active_sources: db.prepare("SELECT COUNT(*) as count FROM sources WHERE status = 'active'").get().count,
    total_articles: db.prepare("SELECT COUNT(*) as count FROM collected_data").get().count,
    total_reports: db.prepare("SELECT COUNT(*) as count FROM reports").get().count,
  };
  res.json(stats);
});

app.listen(PORT, () => {
  console.log(`API Server running at http://localhost:${PORT}`);
});
