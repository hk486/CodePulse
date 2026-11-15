package com.codepulse.gateway;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.reactive.server.WebTestClient;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class GatewayCorsTest {
    @Autowired
    private WebTestClient client;

    @Test
    void allowsLoginPreflightFromFrontendPort3003() {
        client.options().uri("/api/auth/login")
                .header(HttpHeaders.ORIGIN, "http://localhost:3003")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, HttpMethod.POST.name())
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
                .exchange()
                .expectStatus().isOk()
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:3003")
                .expectHeader().valueMatches(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS, ".*POST.*")
                .expectHeader().valueMatches(HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS, "(?i).*content-type.*");
    }

    @Test
    void rejectsUnlistedOrigin() {
        client.options().uri("/api/auth/login")
                .header(HttpHeaders.ORIGIN, "https://example.com")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, HttpMethod.POST.name())
                .exchange()
                .expectStatus().isForbidden()
                .expectHeader().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN);
    }

    @Test
    void protectedCollectionAndNestedRoutesRejectMissingOrInvalidTokens() {
        for (String path : new String[]{"/api/projects", "/api/projects/id/upload",
                "/api/analysis/project/id", "/api/notifications"}) {
            client.get().uri(path)
                    .header(HttpHeaders.ORIGIN, "http://localhost:3003")
                    .exchange()
                    .expectStatus().isUnauthorized()
                    .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:3003");
            client.get().uri(path).header(HttpHeaders.AUTHORIZATION, "Bearer invalid")
                    .header("X-User-Id", "spoofed")
                    .exchange().expectStatus().isUnauthorized();
        }
    }
}
