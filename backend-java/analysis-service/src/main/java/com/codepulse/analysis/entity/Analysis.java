package com.codepulse.analysis.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "analyses")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Analysis {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String analysisId;

    @Column(nullable = false)
    private String projectId;

    @Column(nullable = false)
    private String userId;

    @Column(nullable = false)
    private String status;

    @Column(name = "total_findings")
    private Integer totalFindings;

    @Column(name = "critical_count")
    private Integer criticalCount;

    @Column(name = "high_count")
    private Integer highCount;

    @Column(name = "medium_count")
    private Integer mediumCount;

    @Column(name = "low_count")
    private Integer lowCount;

    @Column(name = "language")
    private String language;

    @Column(name = "started_at")
    private Long startedAt;

    @Column(name = "completed_at")
    private Long completedAt;

    @Column(name = "result_data", columnDefinition = "LONGTEXT")
    private String resultData;

    @PrePersist
    protected void onCreate() {
        startedAt = System.currentTimeMillis();
        if (status == null) {
            status = "PENDING";
        }
    }
}
