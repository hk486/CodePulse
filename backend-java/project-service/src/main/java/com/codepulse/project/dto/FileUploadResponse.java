package com.codepulse.project.dto;

import java.time.LocalDateTime;

public class FileUploadResponse {
    private String fileId;
    private String filename;
    private String originalFilename;
    private String relativePath;
    private long fileSize;
    private String projectId;
    private LocalDateTime uploadedAt;
    private String status;

    public FileUploadResponse() {}

    public FileUploadResponse(String fileId, String filename, String originalFilename, 
                             String relativePath, long fileSize, String projectId, LocalDateTime uploadedAt, String status) {
        this.fileId = fileId;
        this.filename = filename;
        this.originalFilename = originalFilename;
        this.relativePath = relativePath;
        this.fileSize = fileSize;
        this.projectId = projectId;
        this.uploadedAt = uploadedAt;
        this.status = status;
    }

    // Getters and Setters
    public String getFileId() { return fileId; }
    public void setFileId(String fileId) { this.fileId = fileId; }

    public String getFilename() { return filename; }
    public void setFilename(String filename) { this.filename = filename; }

    public String getOriginalFilename() { return originalFilename; }
    public void setOriginalFilename(String originalFilename) { this.originalFilename = originalFilename; }
    public String getRelativePath() { return relativePath; }
    public void setRelativePath(String relativePath) { this.relativePath = relativePath; }

    public long getFileSize() { return fileSize; }
    public void setFileSize(long fileSize) { this.fileSize = fileSize; }

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public LocalDateTime getUploadedAt() { return uploadedAt; }
    public void setUploadedAt(LocalDateTime uploadedAt) { this.uploadedAt = uploadedAt; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}
