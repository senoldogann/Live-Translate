# Nest.js Decision Trees

Architecture decision guides for common choices.

---

## Choosing Database ORM

```
Project Requirements:
├─ Need migrations? -> TypeORM or Prisma
├─ NoSQL database? -> Mongoose
├─ Type safety priority? -> Prisma
├─ Complex relations? -> TypeORM
└─ Existing database? -> TypeORM (better legacy support)
```

---

## Module Organization Strategy

```
Feature Complexity:
├─ Simple CRUD -> Single module with controller + service
├─ Domain logic -> Separate domain module + infrastructure
├─ Shared logic -> Create shared module with exports
├─ Microservice -> Separate app with message patterns
└─ External API -> Create client module with HttpModule
```

---

## Testing Strategy Selection

```
Test Type Required:
├─ Business logic -> Unit tests with mocks
├─ API contracts -> Integration tests with test database
├─ User flows -> E2E tests with Supertest
├─ Performance -> Load tests with k6 or Artillery
└─ Security -> OWASP ZAP or security middleware tests
```

---

## Authentication Method

```
Security Requirements:
├─ Stateless API -> JWT with refresh tokens
├─ Session-based -> Express sessions with Redis
├─ OAuth/Social -> Passport with provider strategies
├─ Multi-tenant -> JWT with tenant claims
└─ Microservices -> Service-to-service auth with mTLS
```

---

## Caching Strategy

```
Data Characteristics:
├─ User-specific -> Redis with user key prefix
├─ Global data -> In-memory cache with TTL
├─ Database results -> Query result cache
├─ Static assets -> CDN with cache headers
└─ Computed values -> Memoization decorators
```

---

## External Resources

### Core Documentation
- [Nest.js Documentation](https://docs.nestjs.com)
- [Nest.js CLI](https://docs.nestjs.com/cli/overview)
- [Nest.js Recipes](https://docs.nestjs.com/recipes)

### Testing Resources
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest](https://github.com/visionmedia/supertest)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)

### Database Resources
- [TypeORM Documentation](https://typeorm.io)
- [Mongoose Documentation](https://mongoosejs.com)

### Authentication
- [Passport.js Strategies](http://www.passportjs.org)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
