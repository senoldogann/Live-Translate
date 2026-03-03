# Nest.js Common Issues Reference

Real issues from GitHub and Stack Overflow with proven solutions.

---

## 1. "Nest can't resolve dependencies of the [Service] (?)"
**Frequency**: HIGHEST (500+ GitHub issues) | **Complexity**: LOW-MEDIUM
**Real Examples**: GitHub #3186, #886, #2359 | SO 75483101

When encountering this error:
1. Check if provider is in module's providers array
2. Verify module exports if crossing boundaries  
3. Check for typos in provider names (GitHub #598 - misleading error)
4. Review import order in barrel exports (GitHub #9095)

---

## 2. "Circular dependency detected"
**Frequency**: HIGH | **Complexity**: HIGH
**Real Examples**: SO 65671318 (32 votes) | Multiple GitHub discussions

Community-proven solutions:
1. Use forwardRef() on BOTH sides of the dependency
2. Extract shared logic to a third module (recommended)
3. Consider if circular dependency indicates design flaw
4. Note: Community warns forwardRef() can mask deeper issues

---

## 3. "Cannot test e2e because Nestjs doesn't resolve dependencies"
**Frequency**: HIGH | **Complexity**: MEDIUM
**Real Examples**: SO 75483101, 62942112, 62822943

Proven testing solutions:
1. Use @golevelup/ts-jest for createMock() helper
2. Mock JwtService in test module providers
3. Import all required modules in Test.createTestingModule()
4. For Bazel users: Special configuration needed (SO 62942112)

---

## 4. "[TypeOrmModule] Unable to connect to the database"
**Frequency**: MEDIUM | **Complexity**: HIGH  
**Real Examples**: GitHub typeorm#1151, #520, #2692

Key insight - this error is often misleading:
1. Check entity configuration - @Column() not @Column('description')
2. For multiple DBs: Use named connections (GitHub #2692)
3. Implement connection error handling to prevent app crash (#520)
4. SQLite: Verify database file path (typeorm#8745)

---

## 5. "Unknown authentication strategy 'jwt'"
**Frequency**: HIGH | **Complexity**: LOW
**Real Examples**: SO 79201800, 74763077, 62799708

Common JWT authentication fixes:
1. Import Strategy from 'passport-jwt' NOT 'passport-local'
2. Ensure JwtModule.secret matches JwtStrategy.secretOrKey
3. Check Bearer token format in Authorization header
4. Set JWT_SECRET environment variable

---

## 6. "ActorModule exporting itself instead of ActorService"
**Frequency**: MEDIUM | **Complexity**: LOW
**Real Example**: GitHub #866

Module export configuration fix:
1. Export the SERVICE not the MODULE from exports array
2. Common mistake: exports: [ActorModule] -> exports: [ActorService]
3. Check all module exports for this pattern
4. Validate with nest info command

---

## 7. "secretOrPrivateKey must have a value" (JWT)
**Frequency**: HIGH | **Complexity**: LOW

JWT configuration fixes:
1. Set JWT_SECRET in environment variables
2. Check ConfigModule loads before JwtModule
3. Verify .env file is in correct location
4. Use ConfigService for dynamic configuration

---

## 8. Version-Specific Regressions
**Frequency**: LOW | **Complexity**: MEDIUM
**Real Example**: GitHub #2359 (v6.3.1 regression)

Handling version-specific bugs:
1. Check GitHub issues for your specific version
2. Try downgrading to previous stable version
3. Update to latest patch version
4. Report regressions with minimal reproduction

---

## 9. "Nest can't resolve dependencies of the UserController (?, +)"
**Frequency**: HIGH | **Complexity**: LOW
**Real Example**: GitHub #886

Controller dependency resolution:
1. The "?" indicates missing provider at that position
2. Count constructor parameters to identify which is missing
3. Add missing service to module providers
4. Check service is properly decorated with @Injectable()

---

## 10. "Nest can't resolve dependencies of the Repository" (Testing)
**Frequency**: MEDIUM | **Complexity**: MEDIUM

TypeORM repository testing:
1. Use getRepositoryToken(Entity) for provider token
2. Mock DataSource in test module
3. Provide test database connection
4. Consider mocking repository completely

---

## 11. "Unauthorized 401 (Missing credentials)" with Passport JWT
**Frequency**: HIGH | **Complexity**: LOW
**Real Example**: SO 74763077

JWT authentication debugging:
1. Verify Authorization header format: "Bearer [token]"
2. Check token expiration (use longer exp for testing)
3. Test without nginx/proxy to isolate issue
4. Use jwt.io to decode and verify token structure

---

## 12. Memory Leaks in Production
**Frequency**: LOW | **Complexity**: HIGH

Memory leak detection and fixes:
1. Profile with node --inspect and Chrome DevTools
2. Remove event listeners in onModuleDestroy()
3. Close database connections properly
4. Monitor heap snapshots over time

---

## 13. Multiple Database Connections
**Frequency**: MEDIUM | **Complexity**: MEDIUM
**Real Example**: GitHub #2692

Configuring multiple databases:
1. Use named connections in TypeOrmModule
2. Specify connection name in @InjectRepository()
3. Configure separate connection options
4. Test each connection independently

---

## 14. "Connection with sqlite database is not established"
**Frequency**: LOW | **Complexity**: LOW
**Real Example**: typeorm#8745

SQLite-specific issues:
1. Check database file path is absolute
2. Ensure directory exists before connection
3. Verify file permissions
4. Use synchronize: true for development

---

## 15. Misleading "Unable to connect" Errors
**Frequency**: MEDIUM | **Complexity**: HIGH
**Real Example**: typeorm#1151

True causes of connection errors:
1. Entity syntax errors show as connection errors
2. Wrong decorator usage: @Column() not @Column('description')
3. Missing decorators on entity properties
4. Always check entity files when connection errors occur

---

## 16. "Typeorm connection error breaks entire nestjs application"
**Frequency**: MEDIUM | **Complexity**: MEDIUM
**Real Example**: typeorm#520

Preventing app crash on DB failure:
1. Wrap connection in try-catch in useFactory
2. Allow app to start without database
3. Implement health checks for DB status
4. Use retryAttempts and retryDelay options
