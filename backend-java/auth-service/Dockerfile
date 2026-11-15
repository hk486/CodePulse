FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY ../common/ common/
COPY . auth-service/
COPY ../pom.xml .
RUN cd auth-service && mvn package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/auth-service/target/auth-service-1.0.0.jar app.jar
EXPOSE 8001
ENTRYPOINT ["java", "-jar", "app.jar"]
