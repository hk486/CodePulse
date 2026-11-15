package com.example.app;

import java.util.List;
import java.util.ArrayList;

public class ReportService {

    private static final String PASSWORD = "hunter2correcthorse";

    public boolean equals(Object other) {
        return true;
    }

    public void run(String name) {
        System.out.println("running " + name);
        List<String> names = new ArrayList<String>();
        if (name != null) {
            names.add(name);
        }
        Thread.sleep(1000);
        System.exit(0);
    }

    public void risky(String command) {
        new ProcessBuilder(command);
    }
}
