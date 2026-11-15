package com.codepulse.project.repository;

import com.codepulse.project.entity.FileUpload;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface FileUploadRepository extends JpaRepository<FileUpload, String> {
    List<FileUpload> findByProjectId(String projectId);
    List<FileUpload> findByProjectIdAndUserId(String projectId, String userId);
    Optional<FileUpload> findByIdAndProjectIdAndUserId(String id, String projectId, String userId);
    void deleteByIdAndProjectIdAndUserId(String id, String projectId, String userId);
}
