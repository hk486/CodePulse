#include <stdio.h>
#include <string.h>

void copy_into(char *destination, const char *source) {
    strcpy(destination, source);
}

void report(const char *name) {
    printf("%s\n", name);
}

int main(void) {
    char buffer[8];
    copy_into(buffer, "a long value that does not fit");
    return 0;
}
