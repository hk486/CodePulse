package com.codepulse.project.controller;

import com.codepulse.project.entity.FileUpload;
import com.codepulse.project.repository.FileUploadRepository;
import com.codepulse.project.service.FileStorageService;
import com.codepulse.project.service.ProjectService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ProjectUploadTest {
    @Test
    void storesAndReturnsRelativePathWithoutUsingItAsStoragePath() throws Exception {
        ProjectController controller = new ProjectController();
        ProjectService projects = mock(ProjectService.class);
        FileStorageService storage = mock(FileStorageService.class);
        FileUploadRepository files = mock(FileUploadRepository.class);
        ReflectionTestUtils.setField(controller, "projectService", projects);
        ReflectionTestUtils.setField(controller, "fileStorageService", storage);
        ReflectionTestUtils.setField(controller, "fileUploadRepository", files);
        when(storage.uploadFile(any(), eq("project"), eq("owner"))).thenReturn("random.java");
        when(files.save(any(FileUpload.class))).thenAnswer(invocation -> invocation.getArgument(0));
        MockMultipartFile file = new MockMultipartFile("file", "Main.java", "text/plain", "class Main {}".getBytes());

        var response = controller.uploadFile("project", file, "repo/src/Main.java", "owner");
        assertEquals("repo/src/Main.java", response.getBody().getRelativePath());
        verify(files).save(argThat(saved -> saved.getRelativePath().equals("repo/src/Main.java")
                && saved.getFilename().equals("random.java")));
        assertThrows(ResponseStatusException.class, () -> controller.uploadFile("project", file, "../Main.java", "owner"));
        verify(storage, times(1)).uploadFile(any(), anyString(), anyString());
    }
}
