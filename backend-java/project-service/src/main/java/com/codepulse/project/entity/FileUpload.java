package com.codepulse.project.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "file_uploads")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class FileUpload {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;
    
    @Column(nullable = false)
    private String projectId;
    
    @Column(nullable = false)
    private String userId;
    
    @Column(nullable = false)
    private String filename;
    
    @Column(nullable = false)
    private String originalFilename;

    @Column(name = "relative_path", length = 1024)
    private String relativePath;
    
    @Column(nullable = false)
    private long fileSize;
    
    private String fileType;
    
    @Column(nullable = false)
    private String status;
    
    @Column(nullable = false)
    private LocalDateTime uploadedAt;

    public FileUpload(String projectId, String userId, String filename, String originalFilename,
                      String relativePath, long fileSize, String fileType) {
        this.projectId = projectId;
        this.userId = userId;
        this.filename = filename;
        this.originalFilename = originalFilename;
        this.relativePath = relativePath;
        this.fileSize = fileSize;
        this.fileType = fileType;
        this.status = "UPLOADED";
        this.uploadedAt = LocalDateTime.now();
    }
}
