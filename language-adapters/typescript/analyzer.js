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
exports.TypeScriptAnalyzer = void 0;
const shared_1 = require("@codepulse/shared");
const glob = __importStar(require("glob"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/**
 * Mock TypeScript Analyzer - Placeholder for Phase 1
 * Real implementation would integrate with ESLint, TypeScript Compiler API, etc.
 */
class TypeScriptAnalyzer {
    constructor() {
        this.id = "typescript-analyzer-v1";
        this.language = "typescript";
        this.displayName = "TypeScript Analyzer";
        this.version = "1.0.0";
    }
    supports(context) {
        return context.detectedLanguages.includes("typescript");
    }
    async analyze(context, config) {
        const findings = [];
        try {
            const tsFiles = await glob.glob("**/*.ts", {
                cwd: context.projectPath,
                ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
                maxDepth: 20,
            });
            for (const file of tsFiles) {
                try {
                    const content = fs.readFileSync(path.join(context.projectPath, file), "utf-8");
                    const lines = content.split("\n");
                    // Example: Check for console.log statements in production code
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        if (line.match(/console\.(log|debug|info)/)) {
                            findings.push({
                                id: `ts-${i}-${file}`,
                                ruleId: "TS-001",
                                language: "typescript",
                                category: shared_1.Category.CODE_QUALITY,
                                severity: shared_1.Severity.LOW,
                                confidence: shared_1.Confidence.HIGH,
                                title: "Console statement found",
                                description: "Avoid console statements in production code. Use proper logging instead.",
                                suggestedAction: "Replace with a proper logger or remove the statement",
                                location: {
                                    filePath: file,
                                    startLine: i + 1,
                                    endLine: i + 1,
                                },
                                tool: "TypeScript Analyzer",
                                toolRuleId: "NO_CONSOLE",
                            });
                        }
                        // Check for any type usage
                        if (line.includes(": any")) {
                            findings.push({
                                id: `ts-any-${i}-${file}`,
                                ruleId: "TS-002",
                                language: "typescript",
                                category: shared_1.Category.CODE_QUALITY,
                                severity: shared_1.Severity.MEDIUM,
                                confidence: shared_1.Confidence.HIGH,
                                title: "Use of 'any' type",
                                description: "Using 'any' defeats the purpose of TypeScript's type system",
                                suggestedAction: "Replace 'any' with a proper type annotation",
                                location: {
                                    filePath: file,
                                    startLine: i + 1,
                                    endLine: i + 1,
                                },
                                tool: "TypeScript Analyzer",
                                toolRuleId: "NO_EXPLICIT_ANY",
                            });
                        }
                    }
                }
                catch (error) {
                    // Skip files that can't be read
                }
            }
        }
        catch (error) {
            console.error("Error analyzing TypeScript files:", error);
        }
        return findings;
    }
}
exports.TypeScriptAnalyzer = TypeScriptAnalyzer;
