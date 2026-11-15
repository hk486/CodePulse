package com.codepulse.gateway;

import com.codepulse.gateway.config.JwtAuthenticationFilter;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;

class JwtAuthenticationFilterTest {
    @Test
    void verifiedSubjectReplacesClientIdentity() {
        String secret = "codepulse-test-secret-long-enough-for-hmac";
        String token = Jwts.builder().subject("verified-user")
                .expiration(new Date(System.currentTimeMillis() + 60000))
                .signWith(Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8))).compact();
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter();
        ReflectionTestUtils.setField(filter, "jwtSecret", secret);
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/projects")
                .header("Authorization", "Bearer " + token)
                .header("X-User-Id", "forged"));
        AtomicReference<String> forwardedUser = new AtomicReference<>();
        filter.apply(new JwtAuthenticationFilter.Config()).filter(exchange, request -> {
            forwardedUser.set(request.getRequest().getHeaders().getFirst("X-User-Id"));
            return Mono.empty();
        }).block();
        assertEquals("verified-user", forwardedUser.get());
    }
}
