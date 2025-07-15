#include "mainwindow.h"
#include <QApplication>
#include <QDebug>

int main(int argc, char *argv[])
{
    qDebug() << "Starting application...";

    QApplication app(argc, argv);
    MainWindow w;

    w.show();

    return result;
}
