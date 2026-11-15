package com.codepulse.project.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public final class UploadPath {
    private UploadPath() {}

    public static String validate(String relativePath, String filename) {
        if (filename == null || filename.isBlank() || filename.length() > 255
                || filename.contains("/") || filename.contains("\\") || filename.equals(".") || filename.equals("..")
                || filename.chars().anyMatch(Character::isISOControl)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid filename");
        }
        String path = relativePath == null ? filename : relativePath;
        if (path.isBlank() || path.length() > 1024 || path.startsWith("/")
                || path.contains("\\") || path.chars().anyMatch(Character::isISOControl)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid relative path");
        }
        String[] parts = path.split("/", -1);
        for (String part : parts) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.length() > 255) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid relative path");
            }
        }
        if (!parts[parts.length - 1].equals(filename)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Relative path does not match filename");
        }
        return path;
    }
}
