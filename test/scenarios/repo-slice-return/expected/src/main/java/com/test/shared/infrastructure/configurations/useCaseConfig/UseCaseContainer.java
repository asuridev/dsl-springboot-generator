package com.test.shared.infrastructure.configurations.useCaseConfig;

import com.test.shared.domain.interfaces.Dispatchable;
import com.test.shared.domain.interfaces.Handler;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class UseCaseContainer {

    private final Map<Class<? extends Dispatchable>, Handler> instances = new HashMap<>();

    public void register(Class<? extends Dispatchable> type, Handler usecase) {
        instances.put(type, usecase);
    }

    public Handler resolve(Class<? extends Dispatchable> type) {
        Handler instance = instances.get(type);
        if (instance == null) {
            throw new IllegalArgumentException("No registered instance found for type: " + type.getName());
        }
        return instance;
    }
}
