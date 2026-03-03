# Skill: C4 Architecture Diagramming
Description: Professional architectural mapping using the C4 Model (Context, Container, Component, Code) with Mermaid syntax.

## 🏗️ The C4 Model
Use this skill to document the system at different levels of abstraction.

### Level 1: System Context
- **Focus:** High-level interactions.
- **Audience:** Everyone.
- **Usage:** Define the system and its users + external system dependencies.

### Level 2: Container Diagram
- **Focus:** The tech stack building blocks (e.g., Next.js App, Postgres DB, Python API).
- **Audience:** Developers and Architects.

### Level 3: Component Diagram
- **Focus:** Logical grouping within a container (e.g., Auth Module, Payment Service).

## 🧜‍♂️ Mermaid Templates

### C4 Context Example
```mermaid
C4Context
  title System Context diagram for My System
  Person(customer, "Customer", "A user of the system")
  System(system, "My System", "Provides services")
  System_Ext(mail, "E-mail System", "Internal Microsoft Exchange")
  
  Rel(customer, system, "Uses")
  Rel(system, mail, "Sends e-mails using")
```

### C4 Container Example
```mermaid
C4Container
  title Container diagram for My System
  Person(customer, "Customer", "A user")
  Container(web_app, "Web Application", "Next.js/React", "Deliver the UI")
  ContainerDb(db, "Database", "PostgreSQL", "Stores user data")
  
  Rel(customer, web_app, "Uses", "HTTPS")
  Rel(web_app, db, "Reads/Writes", "Prisma/TCP")
```

## 📏 Best Practices
1. **Clarity over Complexity:** Only show what is necessary for the current level.
2. **Standard Terminology:** Use "Container" for major apps/DBs and "Component" for modules.
3. **Always Label Relationships:** Do not just draw lines; explain the protocol/reason (e.g., "Uses HTTPS").
