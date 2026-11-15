package com.codepulse.project.service;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.*;

class UploadPathTest {
    @Test
    void acceptsNestedPathsAndLegacyUploads() {
        assertEquals("repo/src/Main.java", UploadPath.validate("repo/src/Main.java", "Main.java"));
        assertEquals("Main.java", UploadPath.validate(null, "Main.java"));
    }

    @Test
    void rejectsUnsafeOrMismatchedPaths() {
        for (String path : new String[]{"/src/Main.java", "../Main.java", "src/../Main.java",
                "src//Main.java", "src\\Main.java", "src/Other.java", "src/\nMain.java"}) {
            assertThrows(ResponseStatusException.class, () -> UploadPath.validate(path, "Main.java"), path);
        }
        assertThrows(ResponseStatusException.class, () -> UploadPath.validate(null, "../Main.java"));
        assertThrows(ResponseStatusException.class, () -> UploadPath.validate("a".repeat(1025), "Main.java"));
    }
}
