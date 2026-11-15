package com.codepulse.common.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ProjectDTO {
    private String projectId;
    private String name;
    private String description;
    private String userId;
    private String status;
    private Long createdAt;
    private Long updatedAt;
    private String repositoryUrl;
    private String language;
}
