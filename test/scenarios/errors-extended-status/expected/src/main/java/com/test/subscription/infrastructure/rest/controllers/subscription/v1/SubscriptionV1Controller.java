package com.test.subscription.infrastructure.rest.controllers.subscription.v1;

import com.test.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.test.subscription.application.commands.CreateSubscriptionCommand;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/subscriptions")
@Slf4j
@Tag(name = "Subscription", description = "Subscription Management API")
public class SubscriptionV1Controller {

    private final UseCaseMediator useCaseMediator;

    public SubscriptionV1Controller(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    /**
     * Create a new subscription.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Create a new subscription.")
    public UUID createSubscription(@Valid @RequestBody CreateSubscriptionCommand command) {
        log.info("createSubscription");
        return useCaseMediator.dispatch(command);
    }
}
