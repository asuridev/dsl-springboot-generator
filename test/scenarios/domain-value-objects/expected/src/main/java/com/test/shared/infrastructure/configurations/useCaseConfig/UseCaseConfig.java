package com.test.shared.infrastructure.configurations.useCaseConfig;

import com.test.shared.domain.annotations.ApplicationComponent;
import com.test.shared.domain.annotations.DomainComponent;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.FilterType;

@Configuration
@ComponentScan(
    basePackages = { "com.test" },
    includeFilters = {
        @ComponentScan.Filter(type = FilterType.ANNOTATION, value = ApplicationComponent.class),
        @ComponentScan.Filter(type = FilterType.ANNOTATION, value = DomainComponent.class)
    }
)
public class UseCaseConfig {}
