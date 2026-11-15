FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY ../common/ common/
COPY . project-service/
COPY ../pom.xml .
RUN cd project-service && mvn package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/project-service/target/project-service-1.0.0.jar app.jar
EXPOSE 8002
ENTRYPOINT ["java", "-jar", "app.jar"]
