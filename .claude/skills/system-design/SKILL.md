---
name: system-design
description: "Use this skill for architecture, scaling, infrastructure (K8s/Docker), and distributed system patterns (Sharding, Caching, Queues)."
---

# SKILL: DISTRIBUTED SYSTEM DESIGN PROTOCOL

> **Principle:** "Design for failure, scale horizontally. Visualization is mandatory."

## PHASE 1: SCALING STRATEGY & DECISION MATRIX
Kod veya diyagramdan önce, mimari kararı ver:

### 1. Vertical vs. Horizontal Scaling
* **Vertical (Scale Up):** MVP ve düşük trafik için. (Limit: Tek sunucu RAM/CPU).
* **Horizontal (Scale Out):** Production ve High-Traffic için.
    * **KURAL:** Uygulama **STATELESS** olmak zorundadır. Session'lar Redis'te, Dosyalar S3/Blob Storage'da tutulmalıdır. Local File System YASAK.

### 2. Component Selection Guide
* **Load Balancer:** Horizontal Scaling varsa zorunludur (Nginx/HAProxy/Cloud LB).
* **Caching (Redis):**
    * *Read-Heavy:* Cache-Aside pattern kullan.
    * *Session Store:* Dağıtık sistemde session yönetimi için zorunlu.
* **Queues (Kafka/RabbitMQ):**
    * *Async:* Email, Rapor gibi kullanıcıyı bekletmemesi gereken işler.
    * *Load Leveling:* Ani trafik artışlarında (Spike) sistemi korumak için.
* **Database Scaling:**
    * *Read Replica:* Okuma yükünü dağıtmak için ilk adım.
    * *Sharding:* Sadece veri tek sunucuya sığmadığında (Son çare).

## PHASE 2: ARCHITECTURE VISUALIZATION (Mermaid.js)
Mimariyi anlatmak yasaktır, **ÇİZMEK** zorunludur.
* **Tool:** Mermaid.js (`graph TD` veya `C4Context`).
* **Requirement:** Servisleri, Load Balancer'ı, Cache katmanını ve Queue yapısını görselleştir.

## PHASE 3: EVENT-DRIVEN & MICROSERVICES
Eğer proje Microservice ise:
1.  **Loose Coupling:** Servisler birbirini doğrudan HTTP ile çağırmamalı, Event fırlatmalı.
2.  **Pattern:** Saga Pattern (Distributed Transaction) veya Event Sourcing düşünülmeli.

## PHASE 4: INFRASTRUCTURE AS CODE (IaC)
Bu mimariyi ayağa kaldıracak dosyaları planla:
* **Containerization:** `Dockerfile` (Multi-stage build zorunlu).
* **Orchestration:**
    * *Simple:* `docker-compose.yaml`
    * *Scale:* `k8s/deployment.yaml` + `hpa.yaml` (Horizontal Pod Autoscaler).

## PHASE 5: DEFENSE IN DEPTH (Security & Resilience)
1.  **SPOF (Single Point of Failure):** Load Balancer arkasında tek sunucu mu var? DB master tek mi?
2.  **Circuit Breaker:** Dış servis çağrılarında (3rd party API) hata toleransı.
3.  **Rate Limiting:** API Gateway seviyesinde koruma.