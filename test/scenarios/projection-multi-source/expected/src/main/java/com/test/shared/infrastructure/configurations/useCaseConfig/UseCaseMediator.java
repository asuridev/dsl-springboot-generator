package com.test.shared.infrastructure.configurations.useCaseConfig;

import com.test.shared.domain.interfaces.Command;
import com.test.shared.domain.interfaces.CommandHandler;
import com.test.shared.domain.interfaces.Query;
import com.test.shared.domain.interfaces.QueryHandler;
import com.test.shared.domain.interfaces.ReturningCommand;
import com.test.shared.domain.interfaces.ReturningCommandHandler;
import org.springframework.stereotype.Component;

@Component
public class UseCaseMediator {

    private final UseCaseContainer useCaseContainer;

    public UseCaseMediator(UseCaseContainer useCaseContainer) {
        this.useCaseContainer = useCaseContainer;
    }

    @SuppressWarnings("unchecked")
    public <R, Q extends Query<R>> R dispatch(Q query) {
        QueryHandler<Q, R> instance = (QueryHandler<Q, R>) useCaseContainer.resolve(query.getClass());
        if (instance == null) {
            throw new IllegalArgumentException("No registered instance found for type: " + query.getClass().getName());
        }
        return instance.handle(query);
    }

    @SuppressWarnings("unchecked")
    public <C extends Command> void dispatch(C command) {
        CommandHandler<C> instance = (CommandHandler<C>) useCaseContainer.resolve(command.getClass());
        if (instance == null) {
            throw new IllegalArgumentException(
                "No registered instance found for type: " + command.getClass().getName()
            );
        }
        instance.handle(command);
    }

    @SuppressWarnings("unchecked")
    public <R, C extends ReturningCommand<R>> R dispatch(C command) {
        ReturningCommandHandler<C, R> instance = (ReturningCommandHandler<C, R>) useCaseContainer.resolve(
            command.getClass()
        );
        if (instance == null) {
            throw new IllegalArgumentException(
                "No registered instance found for type: " + command.getClass().getName()
            );
        }
        return instance.handle(command);
    }
}
