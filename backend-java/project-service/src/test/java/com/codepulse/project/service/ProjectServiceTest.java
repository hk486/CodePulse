package com.codepulse.project.service;

import com.codepulse.common.dto.ProjectDTO;
import com.codepulse.common.exception.ResourceNotFoundException;
import com.codepulse.project.entity.Project;
import com.codepulse.project.repository.ProjectRepository;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ProjectServiceTest {
    @Test
    void preservesMetadataAndAssociatesProjectWithVerifiedUser() {
        ProjectRepository repository = mock(ProjectRepository.class);
        ProjectService service = new ProjectService();
        ReflectionTestUtils.setField(service, "projectRepository", repository);
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ProjectDTO request = new ProjectDTO();
        request.setName("Project");
        request.setUserId("forged");
        request.setLanguage("java");
        request.setRepositoryUrl("https://example.com/repo");

        ProjectDTO result = service.createProject(request, "verified");
        assertEquals("verified", result.getUserId());
        assertEquals("java", result.getLanguage());
        assertEquals("https://example.com/repo", result.getRepositoryUrl());
    }

    @Test
    void preventsReadingAnotherUsersProject() {
        ProjectRepository repository = mock(ProjectRepository.class);
        ProjectService service = new ProjectService();
        ReflectionTestUtils.setField(service, "projectRepository", repository);
        Project project = new Project();
        project.setUserId("owner");
        when(repository.findById("id")).thenReturn(Optional.of(project));
        assertThrows(ResourceNotFoundException.class, () -> service.getProject("id", "other"));
    }
}
