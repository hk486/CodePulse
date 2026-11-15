package com.codepulse.analysis.repository;

import com.codepulse.analysis.entity.Analysis;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface AnalysisRepository extends JpaRepository<Analysis, String> {
    List<Analysis> findByProjectId(String projectId);
    List<Analysis> findByProjectIdAndStatus(String projectId, String status);
    List<Analysis> findByUserId(String userId);
}
