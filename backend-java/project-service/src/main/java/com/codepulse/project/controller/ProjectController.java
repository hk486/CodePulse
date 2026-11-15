package com.codepulse.project.controller;

import com.codepulse.project.service.ProjectService;
import com.codepulse.project.service.FileStorageService;
import com.codepulse.project.service.UploadPath;
import com.codepulse.project.dto.FileUploadResponse;
import com.codepulse.project.entity.FileUpload;
import com.codepulse.project.repository.FileUploadRepository;
import com.codepulse.common.dto.ProjectDTO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/projects")
public class ProjectController {
    private static final Logger log = LoggerFactory.getLogger(ProjectController.class);

    @Autowired
    private ProjectService projectService;

    @Autowired
    private FileStorageService fileStorageService;

    @Autowired
    private FileUploadRepository fileUploadRepository;

    @PostMapping
    public ResponseEntity<ProjectDTO> createProject(@RequestBody ProjectDTO projectDTO,
                                                     @RequestHeader("X-User-Id") String userId) {
        ProjectDTO created = projectService.createProject(projectDTO, userId);
        return new ResponseEntity<>(created, HttpStatus.CREATED);
    }

    @GetMapping("/{projectId}")
    public ResponseEntity<ProjectDTO> getProject(@PathVariable String projectId,
                                                  @RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(projectService.getProject(projectId, userId));
    }

    @GetMapping
    public ResponseEntity<List<ProjectDTO>> getUserProjects(@RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(projectService.getUserProjects(userId));
    }

    @PutMapping("/{projectId}")
    public ResponseEntity<ProjectDTO> updateProject(@PathVariable String projectId,
                                                     @RequestBody ProjectDTO projectDTO,
                                                     @RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(projectService.updateProject(projectId, projectDTO, userId));
    }

    @DeleteMapping("/{projectId}")
    public ResponseEntity<Void> deleteProject(@PathVariable String projectId,
                                              @RequestHeader("X-User-Id") String userId) {
        projectService.getProject(projectId, userId);
        if (!fileUploadRepository.findByProjectIdAndUserId(projectId, userId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Delete uploaded files before deleting the project");
        }
        projectService.deleteProject(projectId, userId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("Project Service is running");
    }

    // File Upload Endpoints
    @PostMapping("/{projectId}/upload")
    public ResponseEntity<FileUploadResponse> uploadFile(
            @PathVariable String projectId,
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "relativePath", required = false) String relativePath,
            @RequestHeader("X-User-Id") String userId) {
        try {
            // Verify project belongs to user
            projectService.getProject(projectId, userId);
            String validatedPath = UploadPath.validate(relativePath, file.getOriginalFilename());
            
            // Save file
            String filename = fileStorageService.uploadFile(file, projectId, userId);
            
            // Store metadata
            FileUpload fileUpload = new FileUpload(
                projectId,
                userId,
                filename,
                file.getOriginalFilename(),
                validatedPath,
                file.getSize(),
                file.getContentType()
            );
            FileUpload saved;
            try {
                saved = fileUploadRepository.save(fileUpload);
            } catch (DataAccessException e) {
                try {
                    fileStorageService.deleteFile(userId, projectId, filename);
                } catch (IOException cleanupError) {
                    e.addSuppressed(cleanupError);
                }
                throw e;
            }
            
            return ResponseEntity.status(HttpStatus.CREATED).body(
                new FileUploadResponse(
                    saved.getId(),
                    saved.getFilename(),
                    saved.getOriginalFilename(),
                    saved.getRelativePath(),
                    saved.getFileSize(),
                    saved.getProjectId(),
                    saved.getUploadedAt(),
                    saved.getStatus()
                )
            );
        } catch (IOException e) {
            log.error("Failed to store upload for project {}", projectId, e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not store file", e);
        }
    }

    @GetMapping("/{projectId}/files")
    public ResponseEntity<List<FileUpload>> getProjectFiles(
            @PathVariable String projectId,
            @RequestHeader("X-User-Id") String userId) {
        // Verify project belongs to user
        projectService.getProject(projectId, userId);
        
        List<FileUpload> files = fileUploadRepository.findByProjectIdAndUserId(projectId, userId);
        return ResponseEntity.ok(files);
    }

    @DeleteMapping("/{projectId}/files/{fileId}")
    public ResponseEntity<Void> deleteFile(
            @PathVariable String projectId,
            @PathVariable String fileId,
            @RequestHeader("X-User-Id") String userId) {
        try {
            // Verify file belongs to user's project
            FileUpload fileUpload = fileUploadRepository.findByIdAndProjectIdAndUserId(fileId, projectId, userId)
                .orElse(null);
            
            if (fileUpload == null) {
                return ResponseEntity.notFound().build();
            }
            
            // Delete physical file
            fileStorageService.deleteFile(userId, projectId, fileUpload.getFilename());
            
            // Delete metadata
            fileUploadRepository.delete(fileUpload);
            
            return ResponseEntity.noContent().build();
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/{projectId}/files/{fileId}/download")
    public ResponseEntity<byte[]> downloadFile(
            @PathVariable String projectId,
            @PathVariable String fileId,
            @RequestHeader("X-User-Id") String userId) {
        try {
            FileUpload fileUpload = fileUploadRepository.findByIdAndProjectIdAndUserId(fileId, projectId, userId)
                .orElse(null);
            
            if (fileUpload == null) {
                return ResponseEntity.notFound().build();
            }
            
            byte[] fileContent = fileStorageService.downloadFile(userId, projectId, fileUpload.getFilename());
            
            return ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"" + fileUpload.getOriginalFilename() + "\"")
                .header("Content-Type", fileUpload.getFileType())
                .body(fileContent);
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
