import { Request, Response, NextFunction } from "express";
import { readFileSync } from "fs";
import { join } from "path";

// Route to markdown file mapping
const routeMarkdownMap: Record<string, string> = {
  "/": "visualizer.md",
  "/visualizer": "visualizer.md",
  "/demodulate": "analysis.md",
  "/draw-signal": "draw-signal.md",
  "/3d-model": "3d-model.md",
  "/hotspot-editor": "hotspot-editor.md",
};

// Token estimation (rough calculation: ~4 characters per token)
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export function markdownContentNegotiation(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Check if client accepts markdown
  const acceptHeader = req.headers.accept || "";
  const acceptsMarkdown = acceptHeader.includes("text/markdown");

  if (!acceptsMarkdown) {
    return next(); // Continue to normal HTML rendering
  }

  // Map route to markdown file
  const markdownFile = routeMarkdownMap[req.path];
  if (!markdownFile) {
    return next(); // No markdown for this route
  }

  try {
    // Read markdown file
    const markdownPath = join(__dirname, "routes", markdownFile);
    const markdownContent = readFileSync(markdownPath, "utf8");

    // Calculate token count
    const tokenCount = estimateTokens(markdownContent);

    // Set appropriate headers for AI agents
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Vary", "Accept");
    res.setHeader("x-markdown-tokens", tokenCount.toString());
    res.setHeader("content-signal", "ai-train=yes, search=yes, ai-input=yes");

    // Send markdown content
    res.send(markdownContent);
  } catch (error) {
    console.error("Error serving markdown:", error);
    next(); // Fall back to normal HTML
  }
}

// Helper function to check if request is from an AI agent
export function isAgentRequest(req: Request): boolean {
  const userAgent = req.headers["user-agent"] || "";
  const acceptHeader = req.headers.accept || "";

  // Common AI agent patterns
  const agentPatterns = [
    "claude-",
    "gpt-",
    "openai",
    "anthropic",
    "copilot",
    "gemini",
    "bard",
    "perplexity",
    "cursor",
    "aider",
    "codeium",
  ];

  // Check user agent for AI agent signatures
  const hasAgentUserAgent = agentPatterns.some((pattern) =>
    userAgent.toLowerCase().includes(pattern),
  );

  // Check for markdown content negotiation
  const wantsMarkdown = acceptHeader.includes("text/markdown");

  return hasAgentUserAgent || wantsMarkdown;
}

// Middleware to add agent detection headers
export function agentDetection(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (isAgentRequest(req)) {
    res.setHeader("x-detected-agent", "true");
    res.setHeader("x-agent-type", "ai-assistant");
  }
  next();
}
