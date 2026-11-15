FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY ../common/ common/
COPY . analysis-service/
COPY ../pom.xml .
RUN cd analysis-service && mvn package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/analysis-service/target/analysis-service-1.0.0.jar app.jar
EXPOSE 8003
ENTRYPOINT ["java", "-jar", "app.jar"]
