"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JavaAnalyzer = void 0;
const shared_1 = require("@codepulse/shared");
const glob = __importStar(require("glob"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/**
 * Mock Java Analyzer - Placeholder for Phase 1
 * This demonstrates the analyzer contract. Real implementation would use PMD/SpotBugs/Checkstyle
 */
class JavaAnalyzer {
    constructor() {
        this.id = "java-analyzer-v1";
        this.language = "java";
        this.displayName = "Java Analyzer";
        this.version = "1.0.0";
    }
    supports(context) {
        return context.detectedLanguages.includes("java");
    }
    async analyze(context, config) {
        const findings = [];
        // Find Java files
        try {
            const javaFiles = await glob.glob("**/*.java", {
                cwd: context.projectPath,
                ignore: ["**/node_modules/**", "**/target/**", "**/.git/**"],
                maxDepth: 20,
            });
            // Analyze each file (placeholder logic)
            for (const file of javaFiles) {
                const filePath = path.join(context.projectPath, file);
                try {
                    const content = fs.readFileSync(filePath, "utf-8");
                    const lines = content.split("\n");
                    // Example: Check for long methods (>50 lines)
                    let inMethod = false;
                    let methodStartLine = 0;
                    let braceCount = 0;
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        if (line.match(/^\s*(public|private|protected)?\s+(static\s+)?.*\(.*\)\s*{/)) {
                            inMethod = true;
                            methodStartLine = i + 1;
                            braceCount = (line.match(/{/g) || []).length;
                        }
                        if (inMethod) {
                            braceCount +=
                                (line.match(/{/g) || []).length -
                                    (line.match(/}/g) || []).length;
                            if (braceCount === 0 && methodStartLine < i) {
                                const methodLength = i - methodStartLine;
                                if (methodLength > 50) {
                                    findings.push({
                                        id: `java-${i}-${file}`,
                                        ruleId: "JAVA-001",
                                        language: "java",
                                        category: shared_1.Category.COMPLEXITY,
                                        severity: shared_1.Severity.MEDIUM,
                                        confidence: shared_1.Confidence.MEDIUM,
                                        title: "Long method detected",
                                        description: `Method spans ${methodLength} lines, exceeding recommended maximum of 50 lines`,
                                        suggestedAction: "Extract method into smaller, focused functions",
                                        location: {
                                            filePath: file,
                                            startLine: methodStartLine,
                                            endLine: i + 1,
                                        },
                                        tool: "Java Analyzer",
                                        toolRuleId: "METHOD_LENGTH_EXCEEDED",
                                    });
                                }
                                inMethod = false;
                            }
                        }
                    }
                }
                catch (error) {
                    // Skip files that can't be read
                }
            }
        }
        catch (error) {
            console.error("Error analyzing Java files:", error);
        }
        return findings;
    }
}
exports.JavaAnalyzer = JavaAnalyzer;
