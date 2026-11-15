package com.codepulse.analysis.controller;

import com.codepulse.analysis.service.AnalysisService;
import com.codepulse.common.dto.AnalysisDTO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/analysis")
public class AnalysisController {

    @Autowired
    private AnalysisService analysisService;

    @PostMapping
    public ResponseEntity<AnalysisDTO> createAnalysis(@RequestBody AnalysisDTO analysisDTO,
                                                       @RequestHeader("X-User-Id") String userId) {
        AnalysisDTO created = analysisService.createAnalysis(analysisDTO, userId);
        return new ResponseEntity<>(created, HttpStatus.CREATED);
    }

    @GetMapping("/{analysisId}")
    public ResponseEntity<AnalysisDTO> getAnalysis(@PathVariable String analysisId,
                                                    @RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(analysisService.getAnalysis(analysisId, userId));
    }

    @GetMapping("/project/{projectId}")
    public ResponseEntity<List<AnalysisDTO>> getProjectAnalyses(@PathVariable String projectId,
                                                                 @RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(analysisService.getProjectAnalyses(projectId, userId));
    }

    @GetMapping("/user/all")
    public ResponseEntity<List<AnalysisDTO>> getUserAnalyses(@RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(analysisService.getUserAnalyses(userId));
    }

    @PutMapping("/{analysisId}/status/{status}")
    public ResponseEntity<AnalysisDTO> updateAnalysisStatus(@PathVariable String analysisId,
                                                             @PathVariable String status,
                                                             @RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(analysisService.updateAnalysisStatus(analysisId, status, userId));
    }

    @PutMapping("/{analysisId}/results")
    public ResponseEntity<AnalysisDTO> updateAnalysisResults(@PathVariable String analysisId,
                                                              @RequestBody AnalysisDTO resultsDTO,
                                                              @RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(analysisService.updateAnalysisResults(analysisId, resultsDTO, userId));
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("Analysis Service is running");
    }
}
