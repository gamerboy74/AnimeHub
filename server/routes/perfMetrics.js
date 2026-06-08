import express from "express";
import { promises as fs } from "fs";
import { resolve as resolvePath } from "path";

const router = express.Router();

// POST /api/perf-metrics — collect frontend performance payloads
router.post("/", async (req, res) => {
  try {
    const payload = req.body;
    const filePath = resolvePath(process.cwd(), "performance-report.json");
    let existing = [];
    try {
      const content = await fs.readFile(filePath, "utf-8");
      existing = JSON.parse(content);
      if (!Array.isArray(existing)) existing = [];
    } catch {
      // file doesn't exist yet — start fresh
    }
    existing.push(payload);
    await fs.writeFile(filePath, JSON.stringify(existing, null, 2));
    res.json({ success: true });
  } catch (e) {
    console.error("perf-metrics write failed", e);
    res.status(500).json({ success: false });
  }
});

export default router;
