# Hilos Virtuales en Handlers — Cuándo y Cómo Usarlos

Este proyecto tiene habilitados los hilos virtuales en Spring Boot (`spring.threads.virtual.enabled=true`).
Cada request ya corre en un hilo virtual. Esta guía cubre el caso específico de handlers que necesitan
ejecutar **múltiples operaciones I/O en paralelo** dentro de un mismo método `handle()`.

---

## Criterio de decisión

Usa `ExecutorService` con hilos virtuales **solo si** se cumplen las dos condiciones:

1. El handler realiza **dos o más operaciones I/O** (consultas a BD, llamadas HTTP, lecturas de caché)
2. Esas operaciones son **independientes entre sí** — el resultado de la primera no es necesario
   para ejecutar la segunda

Si las operaciones son secuenciales (la segunda depende del resultado de la primera), ejecutarlas
en paralelo no aporta nada y añade complejidad innecesaria. Usa el flujo lineal normal.

---

## Casos típicos en la Fase 3

### Candidato — Handler que consulta dos repositorios sin dependencia causal

```
ValidateProductsAndPricesQueryHandler:
  - Consulta lista de productos por ID (BD)     ← independiente
  - Valida precios actuales (BD o caché)        ← independiente
```

```
GetOrderSummaryQueryHandler:
  - Consulta el pedido (BD)                     ← independiente
  - Consulta datos del cliente desde otro BC (HTTP interno)  ← independiente
```

### No candidato — Handler con pasos secuencialmente dependientes

```
ActivateProductCommandHandler:
  1. Verifica categoría activa (BD)
  2. Si categoría activa → crea el product (usa resultado del paso 1)
  3. Persiste el product
```

Los pasos 1, 2 y 3 son causalmente dependientes. No paralelices.

---

## Patrón correcto para Java 21 en producción

> **Nota:** `StructuredTaskScope` (Structured Concurrency) es API preview en Java 21.
> No la uses en producción. El patrón correcto es `ExecutorService` con `try-with-resources`.

```java
@Override
@Transactional(readOnly = true)
@LogExceptions
public ValidateProductsResponse handle(ValidateProductsAndPricesQuery query) {

    try (ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor()) {

        // Lanzar ambas tareas en paralelo — los dos submit() van ANTES de cualquier get()
        Future<List<Product>> productsFuture =
            exec.submit(() -> productRepository.findAllByIds(query.productIds()));

        Future<Map<UUID, Money>> pricesFuture =
            exec.submit(() -> priceRepository.findCurrentPrices(query.productIds()));

        // .get() suspende el hilo virtual actual — NO bloquea un OS thread
        List<Product> products       = productsFuture.get();
        Map<UUID, Money> currentPrices = pricesFuture.get();

        return buildResponse(products, currentPrices);

    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new RuntimeException("Interrupted while validating products", e);
    } catch (ExecutionException e) {
        Throwable cause = e.getCause();
        if (cause instanceof RuntimeException re) throw re;
        throw new RuntimeException("Error validating products", cause);
    }
    // try-with-resources: el executor espera a que ambas tareas terminen antes de cerrarse
}
```

---

## Reglas del patrón

### Los `submit()` siempre antes de los `get()`

```java
// MAL — secuencial disfrazado de paralelo
Future<List<Product>> f1 = exec.submit(() -> productRepository.findAll(ids));
List<Product> products = f1.get();  // espera aquí — la segunda tarea ni ha empezado
Future<Map<UUID, Money>> f2 = exec.submit(() -> priceRepository.findAll(ids));
Map<UUID, Money> prices = f2.get();

// BIEN — verdadero paralelo
Future<List<Product>>    f1 = exec.submit(() -> productRepository.findAll(ids));
Future<Map<UUID, Money>> f2 = exec.submit(() -> priceRepository.findAll(ids));
// ahora ambas tareas están corriendo en paralelo
List<Product>    products = f1.get();
Map<UUID, Money> prices   = f2.get();
```

### `try-with-resources` sobre el `ExecutorService`

`Executors.newVirtualThreadPerTaskExecutor()` implementa `AutoCloseable`. El bloque
`try-with-resources` garantiza que el executor se cierra al salir del bloque y espera
a que todas las tareas pendientes terminen — ciclo de vida acotado y sin fugas.

```java
// BIEN
try (ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor()) {
    // ...
}

// MAL — el executor se crea fuera del try y puede quedar abierto
ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor();
try {
    // ...
} finally {
    exec.shutdown();
    exec.awaitTermination(30, TimeUnit.SECONDS);
}
```

### No hagas pool de hilos virtuales

```java
// MAL — limita la concurrencia sin ningún beneficio
ExecutorService pool = Executors.newFixedThreadPool(10);

// BIEN — un hilo virtual por tarea, sin límite
ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor();
```

---

## Manejo de excepciones

Las excepciones lanzadas dentro de las lambdas del `submit()` se envuelven en `ExecutionException`.
Para que los errores de dominio se propaguen correctamente:

```java
} catch (ExecutionException e) {
    Throwable cause = e.getCause();
    // Si es un error de dominio (RuntimeException), propagarlo sin envolver
    if (cause instanceof RuntimeException re) throw re;
    // Para errores inesperados, envolver en RuntimeException
    throw new RuntimeException("Unexpected error in parallel execution", cause);
}
```

---

## Anotación `@Transactional` con hilos virtuales

Cuando usas `ExecutorService` dentro de un handler `@Transactional`, las lambdas del `submit()`
corren en hilos virtuales **separados** y por tanto **fuera de la transacción del hilo principal**.

Esto es correcto para operaciones de solo lectura (queries) donde cada lambda inicia su propia
transacción de lectura. Para operaciones de escritura, **no uses este patrón** — la consistencia
transaccional no aplica entre hilos distintos.

```java
// SEGURO: query handler con readOnly = true
@Transactional(readOnly = true)
public SomeResponse handle(SomeQuery query) {
    try (ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor()) {
        // Cada lambda tendrá su propia transacción de lectura — correcto
        Future<A> fa = exec.submit(() -> repoA.findAll());
        Future<B> fb = exec.submit(() -> repoB.findAll());
        // ...
    }
}

// EVITAR: command handler con escrituras paralelas
@Transactional
public void handle(SomeCommand command) {
    try (ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor()) {
        // Las escrituras en lambdas separadas no participan de la transacción principal
        // No hagas esto — puede dejar datos inconsistentes
    }
}
```

**Regla práctica:** usa hilos virtuales en paralelo solo en **query handlers**. Los command
handlers generalmente tienen lógica secuencial con transaccionalidad fuerte — no los paralelices.
