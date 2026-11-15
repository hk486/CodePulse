package com.codepulse.analysis.service;

import com.codepulse.analysis.entity.Analysis;
import com.codepulse.analysis.repository.AnalysisRepository;
import com.codepulse.common.dto.AnalysisDTO;
import com.codepulse.common.exception.ResourceNotFoundException;
import com.google.gson.Gson;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class AnalysisService {

    @Autowired
    private AnalysisRepository analysisRepository;

    private final Gson gson = new Gson();

    public AnalysisDTO createAnalysis(AnalysisDTO analysisDTO, String userId) {
        Analysis analysis = new Analysis();
        analysis.setProjectId(analysisDTO.getProjectId());
        analysis.setUserId(userId);
        analysis.setStatus("PENDING");
        analysis.setLanguage(analysisDTO.getLanguage());
        analysis.setTotalFindings(0);
        analysis.setCriticalCount(0);
        analysis.setHighCount(0);
        analysis.setMediumCount(0);
        analysis.setLowCount(0);

        Analysis savedAnalysis = analysisRepository.save(analysis);
        return mapToDTO(savedAnalysis);
    }

    public AnalysisDTO getAnalysis(String analysisId, String userId) {
        Analysis analysis = analysisRepository.findById(analysisId)
                .orElseThrow(() -> new ResourceNotFoundException("Analysis not found"));

        if (!analysis.getUserId().equals(userId)) {
            throw new ResourceNotFoundException("Access denied");
        }

        return mapToDTO(analysis);
    }

    public List<AnalysisDTO> getProjectAnalyses(String projectId, String userId) {
        return analysisRepository.findByProjectId(projectId)
                .stream()
                .filter(a -> a.getUserId().equals(userId))
                .map(this::mapToDTO)
                .collect(Collectors.toList());
    }

    public AnalysisDTO updateAnalysisStatus(String analysisId, String status, String userId) {
        Analysis analysis = analysisRepository.findById(analysisId)
                .orElseThrow(() -> new ResourceNotFoundException("Analysis not found"));

        if (!analysis.getUserId().equals(userId)) {
            throw new ResourceNotFoundException("Access denied");
        }

        analysis.setStatus(status);
        if ("COMPLETED".equals(status)) {
            analysis.setCompletedAt(System.currentTimeMillis());
        }

        Analysis updatedAnalysis = analysisRepository.save(analysis);
        return mapToDTO(updatedAnalysis);
    }

    public AnalysisDTO updateAnalysisResults(String analysisId, AnalysisDTO resultsDTO, String userId) {
        Analysis analysis = analysisRepository.findById(analysisId)
                .orElseThrow(() -> new ResourceNotFoundException("Analysis not found"));

        if (!analysis.getUserId().equals(userId)) {
            throw new ResourceNotFoundException("Access denied");
        }

        analysis.setTotalFindings(resultsDTO.getTotalFindings());
        analysis.setCriticalCount(resultsDTO.getCriticalCount());
        analysis.setHighCount(resultsDTO.getHighCount());
        analysis.setMediumCount(resultsDTO.getMediumCount());
        analysis.setLowCount(resultsDTO.getLowCount());
        analysis.setStatus("COMPLETED");
        analysis.setCompletedAt(System.currentTimeMillis());

        Analysis updatedAnalysis = analysisRepository.save(analysis);
        return mapToDTO(updatedAnalysis);
    }

    public List<AnalysisDTO> getUserAnalyses(String userId) {
        return analysisRepository.findByUserId(userId)
                .stream()
                .map(this::mapToDTO)
                .collect(Collectors.toList());
    }

    private AnalysisDTO mapToDTO(Analysis analysis) {
        return new AnalysisDTO(
                analysis.getAnalysisId(),
                analysis.getProjectId(),
                analysis.getUserId(),
                analysis.getStatus(),
                analysis.getTotalFindings(),
                analysis.getCriticalCount(),
                analysis.getHighCount(),
                analysis.getMediumCount(),
                analysis.getLowCount(),
                analysis.getLanguage(),
                analysis.getStartedAt(),
                analysis.getCompletedAt()
        );
    }
}
