package com.codepulse.project.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;

@Service
public class FileStorageService {

    @Value("${file.upload-dir:uploads}")
    private String uploadDir;

    public String uploadFile(MultipartFile file, String projectId, String userId) throws IOException {
        // Create directory structure
        String dirPath = uploadDir + "/" + userId + "/" + projectId;
        Path uploadPath = Paths.get(dirPath);
        
        if (!Files.exists(uploadPath)) {
            Files.createDirectories(uploadPath);
        }

        // Generate unique filename
        String originalFilename = file.getOriginalFilename();
        String extension = getFileExtension(originalFilename);
        String uniqueFilename = UUID.randomUUID().toString() + extension;
        
        // Save file
        Path filePath = uploadPath.resolve(uniqueFilename);
        Files.copy(file.getInputStream(), filePath);
        
        return uniqueFilename;
    }

    public void deleteFile(String userId, String projectId, String filename) throws IOException {
        Path filePath = Paths.get(uploadDir, userId, projectId, filename);
        if (Files.exists(filePath)) {
            Files.delete(filePath);
        }
    }

    public byte[] downloadFile(String userId, String projectId, String filename) throws IOException {
        Path filePath = Paths.get(uploadDir, userId, projectId, filename);
        return Files.readAllBytes(filePath);
    }

    private String getFileExtension(String filename) {
        if (filename == null || !filename.contains(".")) {
            return "";
        }
        String extension = filename.substring(filename.lastIndexOf("."));
        return extension.matches("\\.[a-zA-Z0-9]{1,16}") ? extension : "";
    }
}
