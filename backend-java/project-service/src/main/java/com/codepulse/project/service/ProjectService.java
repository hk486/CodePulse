package com.codepulse.project.service;

import com.codepulse.project.entity.Project;
import com.codepulse.project.repository.ProjectRepository;
import com.codepulse.common.dto.ProjectDTO;
import com.codepulse.common.exception.ResourceNotFoundException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class ProjectService {

    @Autowired
    private ProjectRepository projectRepository;

    public ProjectDTO createProject(ProjectDTO projectDTO, String userId) {
        Project project = new Project();
        project.setName(projectDTO.getName());
        project.setDescription(projectDTO.getDescription());
        project.setLanguage(projectDTO.getLanguage());
        project.setRepositoryUrl(projectDTO.getRepositoryUrl());
        project.setUserId(userId);
        project.setStatus("ACTIVE");

        Project savedProject = projectRepository.save(project);
        return mapToDTO(savedProject);
    }

    public ProjectDTO getProject(String projectId, String userId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResourceNotFoundException("Project not found"));

        if (!project.getUserId().equals(userId)) {
            throw new ResourceNotFoundException("Access denied");
        }

        return mapToDTO(project);
    }

    public List<ProjectDTO> getUserProjects(String userId) {
        return projectRepository.findByUserId(userId)
                .stream()
                .map(this::mapToDTO)
                .collect(Collectors.toList());
    }

    public ProjectDTO updateProject(String projectId, ProjectDTO projectDTO, String userId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResourceNotFoundException("Project not found"));

        if (!project.getUserId().equals(userId)) {
            throw new ResourceNotFoundException("Access denied");
        }

        if (projectDTO.getName() != null) project.setName(projectDTO.getName());
        if (projectDTO.getDescription() != null) project.setDescription(projectDTO.getDescription());
        if (projectDTO.getLanguage() != null) project.setLanguage(projectDTO.getLanguage());
        if (projectDTO.getRepositoryUrl() != null) project.setRepositoryUrl(projectDTO.getRepositoryUrl());

        Project updatedProject = projectRepository.save(project);
        return mapToDTO(updatedProject);
    }

    public void deleteProject(String projectId, String userId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResourceNotFoundException("Project not found"));

        if (!project.getUserId().equals(userId)) {
            throw new ResourceNotFoundException("Access denied");
        }

        projectRepository.delete(project);
    }

    private ProjectDTO mapToDTO(Project project) {
        return new ProjectDTO(
                project.getProjectId(),
                project.getName(),
                project.getDescription(),
                project.getUserId(),
                project.getStatus(),
                project.getCreatedAt(),
                project.getUpdatedAt(),
                project.getRepositoryUrl(),
                project.getLanguage()
        );
    }
}
