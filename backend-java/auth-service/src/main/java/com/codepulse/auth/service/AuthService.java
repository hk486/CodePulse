package com.codepulse.auth.service;

import com.codepulse.auth.dto.AuthResponse;
import com.codepulse.auth.dto.LoginRequest;
import com.codepulse.auth.dto.RegisterRequest;
import com.codepulse.auth.entity.User;
import com.codepulse.auth.repository.UserRepository;
import com.codepulse.auth.config.JwtTokenProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class AuthService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private PasswordEncoder passwordEncoder;

    public AuthResponse register(RegisterRequest request) {
        String username = request.getUsername();
        if (username == null || username.isBlank()) {
            if (request.getFullName() == null || request.getFullName().isBlank()) {
                throw new IllegalArgumentException("Full name is required");
            }
            username = "user-" + UUID.randomUUID();
        }
        if (request.getEmail() == null || request.getEmail().isBlank()
                || request.getPassword() == null || request.getPassword().length() < 6) {
            throw new IllegalArgumentException("Email and a password of at least 6 characters are required");
        }
        if (userRepository.existsByUsername(username)) {
            throw new RuntimeException("Username already exists");
        }

        if (userRepository.existsByEmail(request.getEmail())) {
            throw new RuntimeException("Email already exists");
        }

        User user = new User();
        user.setUsername(username);
        user.setFullName(request.getFullName() == null ? null : request.getFullName().trim());
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setRole("ROLE_USER");

        User savedUser = userRepository.save(user);

        String token = jwtTokenProvider.generateToken(savedUser.getUserId(), savedUser.getUsername(), savedUser.getRole());

        return new AuthResponse(token, savedUser.getUserId(), savedUser.getUsername(), savedUser.getEmail(), savedUser.getRole(), savedUser.getFullName());
    }

    public AuthResponse login(LoginRequest request) {
        User user = (request.getEmail() != null
                ? userRepository.findByEmail(request.getEmail())
                    .or(() -> userRepository.findByUsername(request.getEmail()))
                : userRepository.findByUsername(request.getUsername()))
                .orElseThrow(() -> new RuntimeException("Invalid email, username or password"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new RuntimeException("Invalid email, username or password");
        }

        String token = jwtTokenProvider.generateToken(user.getUserId(), user.getUsername(), user.getRole());

        return new AuthResponse(token, user.getUserId(), user.getUsername(), user.getEmail(), user.getRole(), user.getFullName());
    }

    public AuthResponse verifyToken(String token) {
        if (!jwtTokenProvider.validateToken(token)) {
            throw new RuntimeException("Invalid token");
        }

        String userId = jwtTokenProvider.getUserIdFromToken(token);
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        return new AuthResponse(token, user.getUserId(), user.getUsername(), user.getEmail(), user.getRole(), user.getFullName());
    }
}
