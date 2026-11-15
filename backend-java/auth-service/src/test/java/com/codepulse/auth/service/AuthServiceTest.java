package com.codepulse.auth.service;

import com.codepulse.auth.config.JwtTokenProvider;
import com.codepulse.auth.dto.LoginRequest;
import com.codepulse.auth.dto.RegisterRequest;
import com.codepulse.auth.entity.User;
import com.codepulse.auth.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AuthServiceTest {
    private final UserRepository users = mock(UserRepository.class);
    private final PasswordEncoder passwords = mock(PasswordEncoder.class);
    private final JwtTokenProvider tokens = mock(JwtTokenProvider.class);
    private final AuthService service = new AuthService();

    @BeforeEach
    void setup() {
        ReflectionTestUtils.setField(service, "userRepository", users);
        ReflectionTestUtils.setField(service, "passwordEncoder", passwords);
        ReflectionTestUtils.setField(service, "jwtTokenProvider", tokens);
        when(tokens.generateToken(any(), any(), any())).thenReturn("token");
    }

    @Test
    void registersFullNameWithoutChangingLegacyUsernameContract() {
        RegisterRequest request = new RegisterRequest();
        request.setFullName("Alex Morgan");
        request.setEmail("alex@example.com");
        request.setPassword("password123");
        when(passwords.encode("password123")).thenReturn("hash");
        when(users.save(any())).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            user.setUserId("id");
            return user;
        });

        var result = service.register(request);
        assertEquals("Alex Morgan", result.getFullName());
        assertTrue(result.getUsername().startsWith("user-"));
        verify(users).save(argThat(user -> "hash".equals(user.getPassword()) && "Alex Morgan".equals(user.getFullName())));

        request.setUsername("legacy");
        assertEquals("legacy", service.register(request).getUsername());
    }

    @Test
    void authenticatesEmailAndLegacyUsernameSeparately() {
        User user = new User();
        user.setUserId("id");
        user.setUsername("legacy");
        user.setEmail("alex@example.com");
        user.setPassword("hash");
        user.setRole("ROLE_USER");
        when(users.findByEmail("alex@example.com")).thenReturn(Optional.of(user));
        when(users.findByUsername("legacy")).thenReturn(Optional.of(user));
        when(passwords.matches("password", "hash")).thenReturn(true);

        LoginRequest emailLogin = new LoginRequest();
        emailLogin.setEmail("alex@example.com");
        emailLogin.setPassword("password");
        assertEquals("id", service.login(emailLogin).getUserId());

        LoginRequest legacyLogin = new LoginRequest();
        legacyLogin.setUsername("legacy");
        legacyLogin.setPassword("password");
        assertEquals("id", service.login(legacyLogin).getUserId());

        when(users.findByEmail("legacy@example.com")).thenReturn(Optional.empty());
        when(users.findByUsername("legacy@example.com")).thenReturn(Optional.of(user));
        emailLogin.setEmail("legacy@example.com");
        assertEquals("id", service.login(emailLogin).getUserId());

        emailLogin.setPassword("wrong");
        assertThrows(RuntimeException.class, () -> service.login(emailLogin));
    }
}
