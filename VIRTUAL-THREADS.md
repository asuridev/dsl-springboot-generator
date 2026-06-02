# Hilos Virtuales en Java 21 — Consideraciones para Sistemas Productivos

> Este proyecto ya tiene habilitados los hilos virtuales en Spring Boot (`spring.threads.virtual.enabled=true`).
> Este documento recoge las consideraciones y buenas prácticas para explotarlos correctamente en producción.

---

## ¿Qué son los hilos virtuales?

Los **hilos virtuales** (Project Loom, JEP 444) son hilos gestionados por la JVM, no por el sistema operativo.
Son extremadamente baratos de crear (costo ~KB vs ~MB de un hilo de plataforma), lo que permite lanzar millones de ellos sin agotar recursos del OS.

```
Hilo de plataforma (OS thread)   Hilo virtual (JVM)
────────────────────────────     ─────────────────────────
~1 MB stack (por defecto)        ~few KB (crece bajo demanda)
Gestionado por el OS             Gestionado por la JVM
~límite práctico: miles          ~límite práctico: millones
Bloqueo = bloquea el OS thread   Bloqueo = libera el carrier thread
```

El modelo de programación no cambia: sigues usando `Thread`, `ExecutorService`, bloques `synchronized`, etc.
Lo que cambia es el costo de bloqueo: una operación de I/O bloqueante **ya no desperdicia** un hilo del OS.

---

## Lo que ya está configurado en este proyecto

Con `spring.threads.virtual.enabled=true`, Spring Boot 3.2+ automáticamente:

- Usa un `VirtualThreadTaskExecutor` para Tomcat (cada request en un hilo virtual)
- Usa un `VirtualThreadTaskExecutor` para `@Async`
- Usa hilos virtuales para tareas programadas con `@Scheduled`

No se requiere ningún cambio adicional en el código de aplicación para recibir la mayor parte del beneficio.

---

## Buenas prácticas

### 1. Nunca uses pools de hilos virtuales

Los pools de hilos tienen sentido para hilos de plataforma porque son caros.
Con hilos virtuales, el pooling es contraproducente: limita la concurrencia sin ningún beneficio real.

```java
// MAL — pool de hilos virtuales
ExecutorService pool = Executors.newFixedThreadPool(200); // NO

// BIEN — ejecutor ilimitado de hilos virtuales
ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor(); // SÍ
```

> **Regla:** si tienes un `ThreadPoolTaskExecutor` configurado manualmente para I/O-bound work, reemplázalo por un executor de hilos virtuales.

---

### 2. Evita el pinning: cuidado con `synchronized`

El **pinning** ocurre cuando un hilo virtual ejecuta código `synchronized` y se bloquea dentro.
En ese caso, el hilo virtual queda "clavado" al carrier thread (hilo del OS), anulando el beneficio del modelo.

```java
// Puede causar pinning si la operación interna bloquea
synchronized (lock) {
    resultado = repository.findById(id); // I/O dentro de synchronized = PINNING
}

// Solución: usar ReentrantLock en lugar de synchronized
private final ReentrantLock lock = new ReentrantLock();

lock.lock();
try {
    resultado = repository.findById(id);
} finally {
    lock.unlock();
}
```

**Cómo detectar pinning:**

```bash
# Al arrancar la JVM, añade:
-Djdk.tracePinnedThreads=full
```

Esto imprime un stack trace en consola cada vez que un hilo virtual queda pinnado.

> **Regla:** dentro de cualquier sección crítica, no hagas I/O, no llames a drivers JDBC síncronos, ni invoques librerías que bloqueen internamente con `synchronized`.

---

### 3. JDBC y drivers de base de datos

Los drivers JDBC tradicionales (síncronos) bloquean dentro de `synchronized`. Dependiendo del driver:

| Driver | Comportamiento con hilos virtuales |
|---|---|
| PostgreSQL JDBC (pgjdbc) | Puede causar pinning en versiones antiguas. Actualizar a ≥ 42.7.x |
| MySQL Connector/J | Puede causar pinning. Usar ≥ 8.2.0 |
| HikariCP | Seguro. Actualizar a ≥ 5.1.0 para soporte explícito |
| R2DBC | No aplica — es reactivo/async |

**Ajuste recomendado del pool de conexiones:**

Con hilos virtuales, las peticiones bloqueadas esperan la conexión virtualmente (sin gastar OS threads).
Esto puede aumentar la presión sobre el pool de conexiones JDBC. Ajusta el tamaño del pool según la capacidad real de la base de datos, **no** según el número de threads disponibles.

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20   # Dimensionado por capacidad de BD, no por concurrencia de threads
      connection-timeout: 3000
```

---

### 4. ThreadLocal y ScopedValue

Los hilos virtuales son compatibles con `ThreadLocal`, pero puede haber un problema de escala:
si creas millones de hilos virtuales y cada uno carga un `ThreadLocal` pesado (como un contexto de seguridad clonado), el consumo de memoria puede crecer.

**Alternativa moderna: `ScopedValue` (Preview en Java 21, estable en Java 23+)**

```java
// ThreadLocal — funciona, pero no es óptimo para millones de hilos
static final ThreadLocal<User> CURRENT_USER = new ThreadLocal<>();

// ScopedValue — inmutable, sin riesgo de memory leak, más eficiente
static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

ScopedValue.where(CURRENT_USER, user).run(() -> {
    // código que puede leer CURRENT_USER.get()
});
```

> **Regla:** Revisa los usos de `InheritableThreadLocal` en librerías de seguridad (Spring Security, MDC de SLF4J). Son generalmente seguros, pero monitoriza el consumo de memoria en carga alta.

---

### 5. No uses `Thread.sleep()` como mecanismo de control

`Thread.sleep()` es seguro y eficiente con hilos virtuales (libera el carrier thread durante el sleep).
Sin embargo, **no lo uses como sustituto de schedulers o mecanismos de backoff**:

```java
// MAL — loop con sleep activo
while (!done) {
    Thread.sleep(100);
    checkCondition();
}

// BIEN — usar mecanismos adecuados
ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
scheduler.scheduleAtFixedRate(this::checkCondition, 0, 100, TimeUnit.MILLISECONDS);
```

---

### 6. Cuidado con librerías que crean sus propios thread pools

Algunas librerías populares gestionan internamente pools de hilos de plataforma.
Con hilos virtuales activos en el server, estas librerías pueden convertirse en el cuello de botella.

| Librería | Consideración |
|---|---|
| RestTemplate | Síncrono — funciona bien con hilos virtuales |
| WebClient (Reactor) | Reactivo — coexiste sin problema, pero elige uno u otro modelo |
| Kafka consumer | Usa hilos de plataforma internamente. Considera aumentar `concurrency` |
| Feign (OpenFeign) | Síncrono — compatible. Revisar timeouts |
| gRPC | Usa Netty internamente. No se beneficia directamente |

---

### 7. Observabilidad y troubleshooting

Con millones de hilos posibles, las herramientas tradicionales pueden mostrar ruido.

**JFR (Java Flight Recorder):**

```bash
-XX:StartFlightRecording=filename=recording.jfr,settings=profile
```

Usa JFR para detectar pinning (`jdk.VirtualThreadPinned`), bloqueos y contención.

**Thread dumps:**

```bash
# Con hilos virtuales, un thread dump puede ser enorme. Filtra:
jcmd <pid> Thread.dump_to_file -format=json /tmp/threads.json
```

**Métricas clave a monitorizar en producción:**

- `jvm.threads.live` — número de hilos virtuales activos (puede ser alto, es normal)
- `jvm.threads.peak` — pico de concurrencia
- Latencia de conexiones del pool JDBC (indicador de saturación de BD)
- `hikaricp.connections.pending` — peticiones esperando conexión al pool

---

### 8. CPU-bound vs I/O-bound

Los hilos virtuales **no mejoran** el trabajo CPU-intensivo. Si tienes tareas que consumen CPU de forma sostenida, sigue usando el `ForkJoinPool` o un pool de hilos de plataforma dimensionado a los núcleos disponibles.

```
I/O-bound (HTTP, JDBC, Redis, S3...)  →  Hilos virtuales: MÁXIMO BENEFICIO
CPU-bound (cálculos, compresión...)    →  Hilos de plataforma: sin cambio necesario
```

> **Regla:** No mezcles tareas CPU-bound y I/O-bound en el mismo executor de hilos virtuales.
> Para tareas CPU intensivas, declara un `TaskExecutor` separado de tipo `ThreadPoolTaskExecutor`.

```java
@Bean("cpuExecutor")
public TaskExecutor cpuTaskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(Runtime.getRuntime().availableProcessors());
    executor.setMaxPoolSize(Runtime.getRuntime().availableProcessors() * 2);
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("cpu-");
    return executor;
}
```

---

### 9. Concurrencia I/O-bound con `ExecutorService` (producción, Java 21)

El caso de uso más común: ejecutar dos operaciones I/O en paralelo (consulta a BD + llamada HTTP)
desde un único use case. En Java 21 en producción, el patrón correcto es:

```java
public UserDashboard execute(UUID userId) throws InterruptedException, ExecutionException {

    try (ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor()) {

        Future<UserProfile> profileFuture =
            exec.submit(() -> userRepository.findById(userId)
                .orElseThrow(() -> new UserNotFoundException(userId)));

        Future<List<Permission>> permissionsFuture =
            exec.submit(() -> permissionsClient.getPermissions(userId));

        // .get() bloquea el hilo virtual actual — NO bloquea un OS thread
        UserProfile      profile = profileFuture.get();
        List<Permission> perms   = permissionsFuture.get();

        return new UserDashboard(profile, perms);

    } // try-with-resources: espera a que ambas tareas terminen antes de cerrarse
}
```

**Por qué funciona:**
- Los dos `submit()` se lanzan antes de cualquier `get()` → corren en paralelo
- Cada `Future.get()` suspende el hilo virtual llamante, liberando el carrier thread
- El `try-with-resources` sobre el `ExecutorService` aísla el ciclo de vida: ninguna tarea escapa del bloque

**Lo que no debes hacer:**

```java
// MAL — secuencial, no hay paralelismo
UserProfile      profile = userRepository.findById(userId);      // espera aquí
List<Permission> perms   = permissionsClient.getPermissions(userId); // luego aquí

// MAL — pool fijo, limita la concurrencia innecesariamente
ExecutorService pool = Executors.newFixedThreadPool(10);
```

---

### 10. Structured Concurrency (Preview en Java 21 — NO usar en producción)

> **Advertencia:** `StructuredTaskScope` es una API en fase **preview** en Java 21 (JEP 453).
> **No debe usarse en sistemas productivos.** Se estabiliza sin preview en Java 25.

Java 21 introduce `StructuredTaskScope` como evolución futura del patrón anterior, con ciclo de vida léxico y cancelación automática al fallo:

```java
// Solo para Java 25+ en producción, o entornos de experimentación con --enable-preview
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<UserProfile>     profile = scope.fork(() -> userRepository.findById(userId));
    Subtask<List<Permission>> perms  = scope.fork(() -> permissionsClient.getPermissions(userId));

    scope.join().throwIfFailed();

    return new UserDashboard(profile.get(), perms.get());
}
```

| | `ExecutorService` (sección 9) | `StructuredTaskScope` |
|---|---|---|
| Listo para producción Java 21 | ✅ | ❌ (preview) |
| Ciclo de vida acotado | ✅ try-with-resources | ✅ léxico |
| Cancelación automática al fallo | ❌ manual | ✅ `ShutdownOnFailure` |
| Stack traces legibles | ✅ | ✅ |

---

### 11. Pruebas de carga y dimensionado

Antes de ir a producción, valida con pruebas de carga que:

1. El throughput mejora respecto al modelo de thread-per-request clásico
2. No hay pinning excesivo (revisar logs con `-Djdk.tracePinnedThreads=full`)
3. El pool de conexiones JDBC no se convierte en cuello de botella
4. La memoria heap se mantiene estable (sin leaks por ThreadLocal)

Herramientas recomendadas: **Gatling**, **k6**, **wrk2**.

---

## Resumen de reglas rápidas

| Regla | Descripción |
|---|---|
| No pool de hilos virtuales | Usa `newVirtualThreadPerTaskExecutor()` o confía en Spring Boot |
| No `synchronized` con I/O dentro | Reemplaza por `ReentrantLock` |
| Actualiza drivers JDBC | Asegúrate de usar versiones compatibles sin pinning |
| Pool JDBC por capacidad de BD | No por número de threads |
| CPU-bound en executor separado | Usa `ThreadPoolTaskExecutor` con núcleos fijos |
| Monitoriza con JFR | Detecta `jdk.VirtualThreadPinned` en producción |
| Revisa librerías de terceros | Identifica las que tienen thread pools propios |
| I/O paralelo con `ExecutorService` | Usa `newVirtualThreadPerTaskExecutor()` + `try-with-resources` |
| No usar `StructuredTaskScope` en prod | Es preview en Java 21; estable solo en Java 25+ |

---

## Referencias

- [JEP 444 — Virtual Threads (Java 21)](https://openjdk.org/jeps/444)
- [JEP 453 — Structured Concurrency (Preview, Java 21)](https://openjdk.org/jeps/453)
- [Spring Boot 3.2 — Virtual Threads Support](https://docs.spring.io/spring-boot/docs/3.2.x/reference/html/features.html#features.spring-application.virtual-threads)
- [HikariCP — Virtual Thread Compatibility](https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing)
- [Pinning detection in Project Loom](https://wiki.openjdk.org/display/loom/Main)
