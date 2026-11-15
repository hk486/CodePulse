FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY ../common/ common/
COPY . api-gateway/
COPY ../pom.xml .
RUN cd api-gateway && mvn package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/api-gateway/target/api-gateway-1.0.0.jar app.jar
EXPOSE 8000
ENTRYPOINT ["java", "-jar", "app.jar"]
