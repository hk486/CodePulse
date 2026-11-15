FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY ../common/ common/
COPY . notification-service/
COPY ../pom.xml .
RUN cd notification-service && mvn package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/notification-service/target/notification-service-1.0.0.jar app.jar
EXPOSE 8004
ENTRYPOINT ["java", "-jar", "app.jar"]
