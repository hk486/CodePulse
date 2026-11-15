package com.codepulse.common.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class AnalysisDTO {
    private String analysisId;
    private String projectId;
    private String userId;
    private String status;
    private Integer totalFindings;
    private Integer criticalCount;
    private Integer highCount;
    private Integer mediumCount;
    private Integer lowCount;
    private String language;
    private Long startedAt;
    private Long completedAt;
}
