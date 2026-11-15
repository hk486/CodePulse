package com.codepulse.notification.controller;

import com.codepulse.notification.service.NotificationService;
import com.codepulse.notification.entity.Notification;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/notifications")
public class NotificationController {

    @Autowired
    private NotificationService notificationService;

    @PostMapping("/send-email")
    public ResponseEntity<String> sendEmailNotification(@RequestBody Map<String, String> request) {
        String email = request.get("email");
        String subject = request.get("subject");
        String body = request.get("body");

        notificationService.sendEmailNotification(email, subject, body);
        return ResponseEntity.ok("Email sent successfully");
    }

    @PostMapping
    public ResponseEntity<Notification> createNotification(@RequestBody Map<String, String> request,
                                                            @RequestHeader("X-User-Id") String userId) {
        String type = request.get("type");
        String subject = request.get("subject");
        String message = request.get("message");

        Notification notification = notificationService.createNotification(userId, type, subject, message);
        return new ResponseEntity<>(notification, HttpStatus.CREATED);
    }

    @GetMapping
    public ResponseEntity<List<Notification>> getUserNotifications(@RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(notificationService.getUserNotifications(userId));
    }

    @GetMapping("/unread")
    public ResponseEntity<List<Notification>> getUnreadNotifications(@RequestHeader("X-User-Id") String userId) {
        return ResponseEntity.ok(notificationService.getUnreadNotifications(userId));
    }

    @PutMapping("/{notificationId}/read")
    public ResponseEntity<Notification> markAsRead(@PathVariable String notificationId) {
        return ResponseEntity.ok(notificationService.markAsRead(notificationId));
    }

    @DeleteMapping("/{notificationId}")
    public ResponseEntity<Void> deleteNotification(@PathVariable String notificationId) {
        notificationService.deleteNotification(notificationId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("Notification Service is running");
    }
}
